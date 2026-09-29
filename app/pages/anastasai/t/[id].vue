<script setup lang="ts">
/**
 * Ticket detail (screens 1b to 1f). Owner: IRDR-458. Layout rail · list · detail · customer
 * context; the list collapses in focus mode, the context panel toggles. The decision bar is sticky.
 * Keyboard: J/K, A (twice for irreversible), E, ⌘⏎, Esc, R, S, F, M, ⏎ (retry), ⌘K commands.
 */
import type { CaseType } from '#shared/case-types'
import { ACTIONS } from '#shared/actions'
import type { RejectReason } from '#shared/services'
import { useCommands } from '~/composables/useCommands'
import { defaultListFilters, type ListFilters } from '~/composables/useInboxFilters'
import { nextTicketNumber, needsDecisionRows } from '~/composables/useInboxRows'
import { useRealtime } from '~/composables/useRealtime'
import { useShortcuts, useShortcutScope } from '~/composables/useShortcuts'
import { useTicketClock } from '~/composables/useTicketClock'
import { ticketShortcutDefs, useTicketDecision } from '~/composables/useTicketDecision'
import { latestExecution, riskEyebrow } from '~/composables/useTicketModel'
import { useTicket, useTicketList } from '~/composables/useTickets'

const MAILBOX = 'support@instaradar.app'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error, refresh } = await useTicket(id)
if (error.value && !data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
}
useHead({
  title: () =>
    data.value
      ? `#${data.value.ticket.displayNumber} ${data.value.ticket.customerName ?? ''}`
      : 'Ticket',
})
useShortcutScope('ticket')

const { nowDate } = useTicketClock()
const { data: list, refresh: refreshList } = useTicketList()
const items = computed(() => list.value?.items ?? [])
const detail = computed(() => data.value ?? null)
const ticket = computed(() => detail.value?.ticket ?? null)
const proposal = computed(() => detail.value?.proposal ?? null)
const currentNumber = computed(() => ticket.value?.displayNumber ?? null)

const decision = useTicketDecision(data, {
  ticketId: () => id.value,
  refresh: async () => {
    await Promise.all([refresh(), refreshList()])
  },
  nextTicket: () =>
    currentNumber.value ? nextTicketNumber(items.value, currentNumber.value) : null,
})
const view = decision.view

// ---------------------------------------------------------------- list, filters, navigation
const listFilters = useState<ListFilters>('tickets:listFilters', defaultListFilters)
const filtersOpen = ref(false)

function go(n: number | null | undefined) {
  if (n) navigateTo(`/anastasai/t/${n}`)
}
function neighbour(dir: 1 | -1): number | null {
  const rows = needsDecisionRows(items.value)
  const all = [...rows, ...items.value.filter((i) => !rows.includes(i) && i.status !== 'closed')]
  const idx = all.findIndex((i) => i.displayNumber === currentNumber.value)
  return all[idx + dir]?.displayNumber ?? null
}

// ---------------------------------------------------------------- dialogs
const rejectOpen = ref(false)
const snoozeOpen = ref(false)
const markDoneOpen = ref(false)
const casePickerOpen = ref(false)
const rejectReason = ref<RejectReason | null>(null)
const { overlayOpen, paletteOpen, register, activeScope } = useShortcuts()
const anyOverlay = () =>
  rejectOpen.value ||
  snoozeOpen.value ||
  markDoneOpen.value ||
  casePickerOpen.value ||
  filtersOpen.value ||
  overlayOpen.value ||
  paletteOpen.value

const canSnooze = computed(() => ticket.value?.riskLevel !== 'safety')
const handledManually = computed(
  () =>
    rejectReason.value === 'handle_myself' ||
    detail.value?.decisions[0]?.rejectReason === 'handle_myself',
)
const riskReason = computed(() => proposal.value?.riskReason ?? ticket.value?.riskReason ?? null)
const heldReason = computed(() => {
  const d = detail.value
  const p = proposal.value
  if (!d || !p) return null
  const reply = decision.actions.value.find((a) => a.type === 'send_reply')
  if (!reply) return null
  const ex = latestExecution(reply, d.executions, p.id)
  if (ex?.status !== 'held') return null
  const blocker = decision.actions.value.find((a) => {
    if (!a.requiredForReply) return false
    return latestExecution(a, d.executions, p.id)?.status === 'failed'
  })
  return blocker ? `Not sent · waiting on “${ACTIONS[blocker.type].label}”` : 'Not sent · held back'
})
const failedNote = computed(() => {
  const d = detail.value
  if (!d) return ''
  const done = d.executions.filter((e) => e.status === 'succeeded').length
  return done > 0
    ? `Retry is safe · ${done === 1 ? 'the finished action is' : `${done} finished actions are`} not repeated`
    : 'Retry is safe · nothing ran yet'
})
const barNote = computed(() => {
  const t = ticket.value
  switch (view.value) {
    case 'decide':
      return decision.normalNote.value
    case 'failed':
      return failedNote.value
    case 'waiting':
      return t?.waitingFor
        ? `${t.waitingFor} · queued actions run after the confirmation`
        : 'Waiting for the customer'
    case 'snoozed':
      return 'Snoozed · it comes back on its own, or now'
    case 'closed':
      return t?.importedAt && !t.resolution
        ? 'Closed · imported from the mailbox history · re-open to answer'
        : `Closed · ${t?.resolution?.replace(/_/g, ' ') ?? 'done'} · read only`
    default:
      return ''
  }
})

const composer = ref<{ submit: () => void } | null>(null)
function viewLog() {
  document.getElementById('audit-trail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function onPickCase(c: CaseType) {
  void decision.setCase(c)
}

// ---------------------------------------------------------------- keyboard and commands
register(
  ticketShortcutDefs({
    decision,
    overlayOpen: anyOverlay,
    openReject: () => (rejectOpen.value = true),
    openSnooze: () => (snoozeOpen.value = true),
    openMarkDone: () => (markDoneOpen.value = true),
    next: () => go(neighbour(1)),
    prev: () => go(neighbour(-1)),
    toInbox: () => navigateTo('/anastasai'),
    toggleFilters: () => (filtersOpen.value = !filtersOpen.value),
  }),
)
register([
  {
    id: 'ticket.pickCase',
    keys: 'enter',
    label: 'Pick the case',
    group: 'Decision',
    scope: 'ticket',
    when: () => !anyOverlay() && view.value === 'unclear',
    handler: () => (casePickerOpen.value = true),
  },
  {
    id: 'ticket.send.manual',
    keys: 'mod+enter',
    label: 'Send your reply',
    group: 'Decision',
    scope: 'ticket',
    allowInInput: true,
    when: () => !anyOverlay() && view.value === 'manual',
    handler: () => composer.value?.submit(),
  },
])

const { register: registerCommands } = useCommands()
registerCommands([
  {
    id: 'ticket.cmd.approve',
    label: 'Approve',
    group: 'Ticket',
    keys: 'a',
    when: () => view.value === 'decide',
    run: () => decision.approve(),
  },
  {
    id: 'ticket.cmd.edit',
    label: 'Edit the reply',
    group: 'Ticket',
    keys: 'e',
    when: () => decision.canEdit.value,
    run: () => decision.toggleEdit(true),
  },
  {
    id: 'ticket.cmd.reject',
    label: 'Reject',
    group: 'Ticket',
    keys: 'r',
    when: () => view.value === 'decide',
    run: () => (rejectOpen.value = true),
  },
  {
    id: 'ticket.cmd.snooze',
    label: 'Snooze',
    group: 'Ticket',
    keys: 's',
    when: () => (view.value === 'decide' || view.value === 'unclear') && canSnooze.value,
    run: () => (snoozeOpen.value = true),
  },
  {
    id: 'ticket.cmd.case',
    label: 'Change case',
    group: 'Ticket',
    when: () => view.value !== 'closed',
    run: () => (casePickerOpen.value = true),
  },
  {
    id: 'ticket.cmd.rerun',
    label: 'Re-run research',
    group: 'Ticket',
    when: () => view.value !== 'closed' && view.value !== 'executing',
    run: () => decision.rerun(),
  },
  {
    id: 'ticket.cmd.reopen',
    label: 'Re-open and draft a reply',
    group: 'Ticket',
    when: () => view.value === 'closed',
    run: () => decision.rerun(),
  },
  {
    id: 'ticket.cmd.retry',
    label: 'Retry the failed action',
    group: 'Ticket',
    keys: 'enter',
    when: () => view.value === 'failed',
    run: () => decision.retry(),
  },
  {
    id: 'ticket.cmd.markdone',
    label: 'Mark as done manually',
    group: 'Ticket',
    keys: 'm',
    when: () => view.value === 'failed' || view.value === 'manual' || view.value === 'waiting',
    run: () => (markDoneOpen.value = true),
  },
  {
    id: 'ticket.cmd.unsnooze',
    label: 'Unsnooze',
    group: 'Ticket',
    keys: 's',
    when: () => view.value === 'snoozed',
    run: () => decision.unsnooze(),
  },
  {
    id: 'ticket.cmd.undo',
    label: 'Undo the automatic handling',
    group: 'Ticket',
    when: () => view.value === 'auto',
    run: () => decision.undo(),
  },
  {
    id: 'ticket.cmd.filters',
    label: 'Filter the list',
    group: 'Ticket',
    keys: 'f',
    run: () => (filtersOpen.value = true),
  },
])

// ---------------------------------------------------------------- live updates and focus
const realtime = useRealtime()
let refreshTimer: ReturnType<typeof setTimeout> | null = null
realtime.onChange(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refresh()
  }, 250)
})

function focusCurrentRow() {
  if (import.meta.server) return
  nextTick(() => {
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return
    const row = document.querySelector<HTMLElement>(
      'aside[aria-label="Ticket list"] [aria-current="true"]',
    )
    if (row) {
      row.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
    } else {
      document
        .querySelector<HTMLElement>('main [role="toolbar"] button')
        ?.focus({ preventScroll: true })
    }
  })
}
onMounted(() => {
  activeScope.value = 'ticket'
  focusCurrentRow()
})
watch(currentNumber, () => {
  rejectOpen.value = false
  snoozeOpen.value = false
  markDoneOpen.value = false
  casePickerOpen.value = false
  rejectReason.value = null
  focusCurrentRow()
})
</script>

<template>
  <ShellColumns>
    <template #list>
      <TicketList
        v-model:filters="listFilters"
        v-model:filters-open="filtersOpen"
        :items="items"
        :current-number="currentNumber"
        :now="nowDate"
        :mailbox="MAILBOX"
      />
    </template>

    <div
      v-if="detail && ticket"
      class="grid flex-1 auto-rows-max grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-auto px-8 pb-9 pt-[22px]"
    >
      <TicketHeader
        v-model:case-picker-open="casePickerOpen"
        :ticket="ticket"
        :proposal="proposal"
        :actions="decision.actions.value"
        :executions="detail.executions"
        :now="nowDate"
        :case-editable="view !== 'closed' && view !== 'executing'"
        @set-case="onPickCase"
      />

      <RiskBanner
        v-if="ticket.riskLevel !== 'none' && riskReason && view !== 'closed'"
        :level="ticket.riskLevel"
        :eyebrow="riskEyebrow(ticket)"
        >{{ riskReason }}</RiskBanner
      >
      <TicketParkedBanner
        v-if="view === 'waiting' || view === 'snoozed'"
        :ticket="ticket"
        :actions="decision.actions.value"
        :now="nowDate"
      />

      <TicketOutcome v-if="view === 'closed'" :detail="detail" :now="nowDate" />
      <TicketProposalPanel v-else-if="proposal" :proposal="proposal" />
      <TicketResearchingPanel v-else :run="detail.runs[0] ?? null" />

      <TicketMessageThread :messages="detail.messages" :now="nowDate" />

      <TicketManualComposer
        v-if="view === 'manual'"
        ref="composer"
        :ticket="ticket"
        :busy="decision.busy.value"
        :handled-manually="handledManually"
        @send="(input) => decision.manualSend(input)"
      />
      <TicketExecutionProgress
        v-else-if="view === 'executing' && proposal"
        :actions="decision.actions.value"
        :live-executions="decision.liveExecutions.value"
        :executions="detail.executions"
        :proposal-id="proposal.id"
      />
      <TicketActionsChecklist
        v-else-if="proposal && view !== 'closed'"
        :actions="decision.actions.value"
        :executions="detail.executions"
        :live-executions="decision.liveExecutions.value"
        :proposal-id="proposal.id"
        :editable="decision.canDecide.value"
        :attachments="proposal.reply?.attachments.length ?? 0"
        :available="decision.availableActions.value"
        :meta-line="view === 'failed' ? proposal.metaLine : null"
        @set-enabled="decision.setEnabled"
        @set-params="decision.setParams"
        @add="decision.addAction"
        @remove="decision.removeAction"
      />

      <TicketReplyDraft
        v-if="proposal?.reply && view !== 'manual' && view !== 'closed'"
        v-model:body="decision.replyBody.value"
        v-model:subject="decision.replySubject.value"
        :reply="proposal.reply"
        :editing="decision.editing.value"
        :editable="decision.canEdit.value"
        :dirty="decision.replyDirty.value"
        :held="heldReason"
        :mismatches="decision.mismatches.value"
        @toggle-edit="(f) => decision.toggleEdit(f)"
        @discard="decision.discardEdits"
      />

      <TicketResearchSection
        v-if="proposal"
        :proposal="proposal"
        :runs="detail.runs"
        :usage="detail.usage ?? null"
        :evidence-open="ticket.riskLevel !== 'none'"
      />

      <TicketAuditTrail
        v-if="detail.executions.length || detail.decisions.length"
        :executions="detail.executions"
        :decisions="detail.decisions"
        :now="nowDate"
      />
    </div>
    <div v-else class="flex flex-1 flex-col items-start gap-4 px-8 pt-[22px]">
      <Eyebrow tone="accent">404</Eyebrow>
      <p class="type-heading">Nothing here.</p>
      <Button variant="secondary" kbd="Esc" to="/anastasai">Back to the inbox</Button>
    </div>

    <TicketDecisionBar
      :view="view"
      :phase="decision.phase.value"
      :primary="decision.primary.value"
      :note="barNote"
      :confirm-text="decision.confirmText.value"
      :confirm-count="decision.confirmCount.value"
      :busy="decision.busy.value"
      :can-snooze="canSnooze"
      @approve="decision.approve"
      @back="decision.back"
      @edit="decision.toggleEdit()"
      @reject="rejectOpen = true"
      @snooze="snoozeOpen = true"
      @retry="decision.retry"
      @mark-done="markDoneOpen = true"
      @view-log="viewLog"
      @unsnooze="decision.unsnooze"
      @undo="decision.undo"
      @rerun="decision.rerun"
      @pick-case="casePickerOpen = true"
      @send="composer?.submit()"
      @to-inbox="navigateTo('/anastasai')"
    />

    <template #context>
      <TicketContextPanel :context="ticket?.customerContext ?? null" />
    </template>

    <TicketRejectDialog
      v-model:open="rejectOpen"
      @pick="
        (r) => {
          rejectReason = r
          decision.reject(r)
        }
      "
    />
    <TicketSnoozeDialog
      v-model:open="snoozeOpen"
      :now="nowDate"
      @pick="(d) => decision.snooze(d)"
    />
    <TicketMarkDoneDialog v-model:open="markDoneOpen" @confirm="(n) => decision.markDone(n)" />
  </ShellColumns>
</template>
