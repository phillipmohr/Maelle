<script setup lang="ts">
/**
 * Ticket detail. Owner: IRDR-458 (screens 1b to 1f). Foundation placeholder: renders the proposal,
 * actions, reply and research from the stub so the layout (rail · list · detail · context) is real.
 */
import { caseLabel, caseShortLabel } from '#shared/case-types'
import { actionLabel, isIrreversible } from '#shared/actions'
import { ageShort } from '~/utils/format'
import { useTicket, useTicketList } from '~/composables/useTickets'
import { useShortcuts, useShortcutScope } from '~/composables/useShortcuts'
import { useShell } from '~/composables/useShell'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error } = await useTicket(id)
if (error.value) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
useHead({
  title: () =>
    data.value
      ? `#${data.value.ticket.displayNumber} ${data.value.ticket.customerName ?? ''}`
      : 'Ticket',
})
useShortcutScope('ticket')

const { data: list } = useTicketList()
const open = computed(() =>
  (list.value?.items ?? []).filter((t) =>
    ['new', 'researching', 'needs_decision', 'executing', 'action_failed', 'manual'].includes(
      t.status,
    ),
  ),
)
const waiting = computed(() =>
  (list.value?.items ?? []).filter((t) => t.status === 'waiting_on_customer'),
)
const snoozed = computed(() => (list.value?.items ?? []).filter((t) => t.status === 'snoozed'))

const { toggleFocusMode, toggleContext } = useShell()
const { register } = useShortcuts()
register([
  {
    id: 'ticket.next',
    keys: 'j',
    label: 'Next ticket',
    group: 'Ticket',
    scope: 'ticket',
    handler: () => {
      const i = open.value.findIndex((t) => String(t.displayNumber) === id.value)
      const n = open.value[i + 1]
      if (n) navigateTo(`/anastasai/t/${n.displayNumber}`)
    },
  },
  {
    id: 'ticket.prev',
    keys: 'k',
    label: 'Previous ticket',
    group: 'Ticket',
    scope: 'ticket',
    handler: () => {
      const i = open.value.findIndex((t) => String(t.displayNumber) === id.value)
      const p = open.value[i - 1]
      if (p) navigateTo(`/anastasai/t/${p.displayNumber}`)
    },
  },
  {
    id: 'ticket.back',
    keys: 'escape',
    label: 'Back to inbox',
    group: 'Ticket',
    scope: 'ticket',
    handler: () => navigateTo('/anastasai'),
  },
  {
    id: 'ticket.focus',
    keys: 'f',
    label: 'Toggle focus mode',
    group: 'View',
    scope: 'ticket',
    handler: toggleFocusMode,
  },
  {
    id: 'ticket.context',
    keys: 'c',
    label: 'Toggle customer context',
    group: 'View',
    scope: 'ticket',
    handler: toggleContext,
  },
])

const ticket = computed(() => data.value?.ticket)
const proposal = computed(() => data.value?.proposal)
const rowKind = (t: { status: string; riskLevel: string }) =>
  t.status === 'researching'
    ? 'research'
    : t.status === 'action_failed'
      ? 'failed'
      : t.riskLevel === 'none'
        ? 'none'
        : (t.riskLevel as 'high' | 'safety')
</script>

<template>
  <ShellColumns>
    <template #list>
      <div class="flex flex-col gap-[14px] px-[18px] pb-[14px] pt-5">
        <div class="flex items-baseline justify-between">
          <span class="font-serif text-heading leading-none">Inbox</span>
          <Mono class="text-[11px]">support@instaradar.app</Mono>
        </div>
        <button
          type="button"
          class="flex items-center justify-between rounded-md border border-line px-[10px] py-2 text-left text-small text-fg-muted hover:border-line-strong"
          @click="useShortcuts().paletteOpen.value = true"
        >
          <span>Search or run a command</span><Kbd keys="⌘K" />
        </button>
        <div class="flex items-center gap-[6px]">
          <Chip variant="filter" active interactive>All</Chip>
          <Chip variant="filter" interactive>Risk</Chip>
          <Chip variant="filter" interactive>Billing</Chip>
          <span class="flex-1" /><Kbd keys="F" />
        </div>
      </div>
      <ScrollArea class="flex-1">
        <template
          v-for="g in [
            { name: 'Needs decision', rows: open },
            { name: 'Waiting on customer', rows: waiting },
            { name: 'Snoozed', rows: snoozed },
          ]"
          :key="g.name"
        >
          <div class="flex justify-between px-[18px] pb-2 pt-4">
            <Eyebrow>{{ g.name }}</Eyebrow>
            <Mono class="text-[11px]">{{ g.rows.length }}</Mono>
          </div>
          <div
            v-if="g.rows.length === 0"
            class="border-t border-line py-[10px] pl-10 pr-[18px] text-caption text-fg-muted"
          >
            Clear
          </div>
          <TicketRow
            v-for="t in g.rows"
            :key="t.id"
            :to="`/anastasai/t/${t.displayNumber}`"
            :name="t.customerName ?? t.customerEmail"
            :sub="
              t.caseType
                ? `${caseShortLabel(t.caseType)} · ${t.proposalLine ?? ''} · ${t.actionCount} action${t.actionCount === 1 ? '' : 's'}`
                : 'Researching'
            "
            :time="
              t.status === 'snoozed' && t.snoozedUntil
                ? ageShort(t.snoozedUntil)
                : ageShort(t.lastCustomerMessageAt ?? t.createdAt)
            "
            :risk="
              t.status === 'waiting_on_customer'
                ? 'wait'
                : t.status === 'snoozed'
                  ? 'snoozed'
                  : rowKind(t)
            "
            :research="
              t.runProgress
                ? Object.entries(t.runProgress)
                    .map(([k, v]) => `${k} ${v === 'ok' ? '✓' : v === 'pending' ? '⋯' : '×'}`)
                    .join('  ')
                : null
            "
            :tag="
              t.status === 'action_failed'
                ? 'Retry or mark done'
                : t.stage === 2 && t.status === 'needs_decision'
                  ? 'Returned from waiting'
                  : null
            "
            :tag-tone="t.status === 'action_failed' ? 'brick' : 'slate-blue'"
            :selected="String(t.displayNumber) === id"
          />
        </template>
      </ScrollArea>
    </template>

    <div
      v-if="ticket"
      class="grid flex-1 auto-rows-max content-start gap-6 overflow-auto px-8 pb-9 pt-[22px]"
    >
      <div class="flex flex-col gap-[10px]">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-baseline gap-[10px]">
            <span class="whitespace-nowrap text-[18px] font-semibold">{{
              ticket.customerName ?? ticket.customerEmail
            }}</span>
            <Mono class="truncate">{{ ticket.customerEmail }}</Mono>
          </div>
          <div class="flex shrink-0 items-center gap-[6px]">
            <Mono class="mr-[6px]">#{{ ticket.displayNumber }}</Mono>
            <Kbd keys="K" /><Kbd keys="J" />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Chip variant="tag" class="font-medium">{{
            ticket.caseType ? caseLabel(ticket.caseType) : 'Classifying…'
          }}</Chip>
          <StatusPill v-if="ticket.riskLevel === 'high'" status="warning">High risk</StatusPill>
          <StatusPill v-if="ticket.riskLevel === 'safety'" status="warning">Safety</StatusPill>
          <StatusPill v-if="ticket.status === 'action_failed'" status="error"
            >1 action failed</StatusPill
          >
          <StatusPill v-else-if="ticket.status === 'needs_decision'" status="draft"
            >Needs decision</StatusPill
          >
          <StatusPill v-else-if="ticket.status === 'researching'" status="info"
            >Researching</StatusPill
          >
          <Chip v-if="ticket.dueDate" variant="meta"
            >Due
            {{
              new Date(ticket.dueDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            }}</Chip
          >
          <Chip v-if="proposal?.customerConfirmationNeeded" variant="meta"
            >Stage {{ ticket.stage }} of 2</Chip
          >
        </div>
      </div>

      <RiskBanner
        v-if="ticket.riskLevel !== 'none' && ticket.riskReason"
        :level="ticket.riskLevel"
        :eyebrow="
          ticket.riskLevel === 'high'
            ? 'High risk · ' +
              (ticket.caseType ? caseShortLabel(ticket.caseType).toLowerCase() : '')
            : 'Safety'
        "
      >
        {{ ticket.riskReason }}
      </RiskBanner>

      <Panel v-if="proposal" elevation="focus" :padding="24">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <Eyebrow tone="accent">Proposal</Eyebrow>
            <Mono class="text-[11px]">{{ proposal.metaLine }}</Mono>
          </div>
          <p class="type-heading">{{ proposal.summaryLine }}</p>
          <Provenance
            >Prepared by AnastasAI from
            {{
              proposal.research
                .map((r) => r.sources[0]?.label.split(' · ')[0])
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .join(', ')
            }}</Provenance
          >
        </div>
      </Panel>
      <Panel v-else :padding="24" class="text-fg-muted">
        <div class="flex items-center gap-3">
          <RiskDot kind="research" /><span class="text-body"
            >Researching · Stripe ✓ Supabase ✓ Vercel ⋯ KB ✓</span
          >
        </div>
      </Panel>

      <div v-if="data?.messages.length" class="flex flex-col gap-[10px]">
        <div class="flex items-baseline justify-between">
          <Eyebrow>Customer message</Eyebrow>
          <Mono class="text-[11px]"
            >{{ data.messages.length }} message{{ data.messages.length === 1 ? '' : 's' }}</Mono
          >
        </div>
        <div
          v-for="m in data.messages"
          :key="m.id"
          class="flex flex-col gap-[10px] rounded-md border border-line bg-base px-[18px] py-4 text-body leading-[1.6]"
        >
          <div class="flex items-center justify-between">
            <Mono class="text-[11px]">{{
              m.direction === 'in' ? m.fromEmail : 'support@instaradar.app → ' + m.toEmails[0]
            }}</Mono
            ><Mono class="text-[11px]">{{ ageShort(m.createdAt) }} ago</Mono>
          </div>
          <p
            v-for="(p, i) in (m.textBody ?? '').split(/\n\n+/)"
            :key="i"
            class="[text-wrap:pretty] whitespace-pre-line"
          >
            {{ p }}
          </p>
        </div>
      </div>

      <Panel v-if="proposal">
        <PanelHeader title="Proposed actions" :meta="`${proposal.actions.length} of 11`" eyebrow />
        <div class="divide-hairline">
          <div
            v-for="a in proposal.actions"
            :key="a.id"
            class="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-3 px-[18px] py-[13px]"
            :class="a.stage === 'after_confirmation' && 'bg-slate-blue/4'"
          >
            <Checkbox
              class="mt-[2px]"
              :model-value="a.enabled"
              readonly
              :tone="
                data?.executions.find((e) => e.type === a.type)?.status === 'succeeded'
                  ? 'success'
                  : data?.executions.find((e) => e.type === a.type)?.status === 'failed'
                    ? 'error'
                    : data?.executions.find((e) => e.type === a.type)?.status === 'held'
                      ? 'held'
                      : a.stage === 'after_confirmation'
                        ? 'queued'
                        : 'default'
              "
            />
            <div class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-baseline gap-[10px]">
                <span
                  class="text-body font-semibold"
                  :class="isIrreversible(a.type) ? 'text-ember' : 'text-fg'"
                  >{{ actionLabel(a.type) }}</span
                >
                <Mono>{{
                  Object.entries(a.params)
                    .filter(
                      ([k]) =>
                        ![
                          'stripeSubscriptionId',
                          'stripePaymentIntentId',
                          'stripeCustomerId',
                          'stripeChargeId',
                          'currency',
                          'includeAttachments',
                          'cc',
                          'reason',
                          'description',
                        ].includes(k),
                    )
                    .map(([, v]) => String(v))
                    .join(' · ')
                }}</Mono>
              </div>
              <span class="text-caption leading-[1.45] text-fg-muted">{{ a.reason }}</span>
              <div
                v-if="data?.executions.find((e) => e.type === a.type && e.status === 'failed')"
                class="mt-1 rounded-md border border-brick/33 bg-brick/8 px-3 py-2 font-mono text-[11.5px] text-brick"
              >
                {{ data.executions.find((e) => e.type === a.type && e.status === 'failed')?.error }}
              </div>
            </div>
            <div class="flex items-start gap-2">
              <span
                v-if="isIrreversible(a.type)"
                class="inline-flex items-center gap-[6px] rounded-sm border border-ember/33 bg-ember/8 px-2 py-[2px] text-[11px] font-semibold text-ember"
                ><LockShape />Irreversible</span
              >
              <span
                v-else
                class="rounded-sm border border-line px-2 py-[2px] text-[11px] font-medium text-fg-muted"
                >Reversible</span
              >
              <StatusPill v-if="a.stage === 'after_confirmation'" status="info"
                >Queued · pending confirmation</StatusPill
              >
              <StatusPill v-else-if="a.requiredForReply && !data?.executions.length" status="draft"
                >Required</StatusPill
              >
              <StatusPill
                v-else-if="data?.executions.find((e) => e.type === a.type)?.status === 'succeeded'"
                status="success"
                >{{
                  (
                    data.executions.find((e) => e.type === a.type)?.result as {
                      linked?: boolean
                    } | null
                  )?.linked
                    ? 'Linked'
                    : 'Done'
                }}</StatusPill
              >
              <StatusPill
                v-else-if="data?.executions.find((e) => e.type === a.type)?.status === 'failed'"
                status="error"
                >Failed</StatusPill
              >
              <StatusPill
                v-else-if="data?.executions.find((e) => e.type === a.type)?.status === 'held'"
                status="warning"
                >Held back</StatusPill
              >
            </div>
          </div>
        </div>
        <div
          class="flex items-center gap-[10px] border-t border-line px-[18px] py-[11px] text-small text-fg-muted"
        >
          <span class="font-semibold text-fg">+ Add action</span
          ><span>from the predefined list</span>
        </div>
      </Panel>

      <div v-if="proposal?.reply" class="flex flex-col gap-[10px]">
        <div class="flex items-baseline justify-between">
          <Eyebrow>Reply draft</Eyebrow>
          <Mono class="text-[11px]"
            >Template · {{ proposal.reply.template ?? 'from the protocol' }}</Mono
          >
        </div>
        <div class="flex flex-col overflow-hidden rounded-md border border-line bg-base">
          <div
            class="flex justify-between border-b border-line px-[18px] py-[10px] font-mono text-[11px] text-fg-muted"
          >
            <span>support@instaradar.app → {{ proposal.reply.to }}</span>
            <span class="flex items-center gap-[6px]">Edit <Kbd keys="E" /></span>
          </div>
          <div class="flex flex-col gap-3 px-[18px] pb-[18px] pt-4 text-body leading-[1.6]">
            <p
              v-for="(p, i) in proposal.reply.body.split(/\n\n+/)"
              :key="i"
              class="[text-wrap:pretty] whitespace-pre-line"
            >
              {{ p }}
            </p>
          </div>
          <div v-if="proposal.reply.attachments.length" class="px-[18px] pb-4">
            <SourceChip
              v-for="att in proposal.reply.attachments"
              :key="att.storagePath"
              class="px-2 py-1"
              >{{ att.name }} · {{ Math.round((att.sizeBytes ?? 0) / 1024) }} KB</SourceChip
            >
          </div>
        </div>
      </div>

      <div v-if="proposal" class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <Eyebrow>Research</Eyebrow>
          <div class="flex items-center gap-[10px]">
            <StatusPill v-for="w in proposal.researchWarnings" :key="w" status="warning">{{
              w
            }}</StatusPill>
            <Mono class="text-[11px]">{{ proposal.research.length }} findings</Mono>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          <div
            v-for="(r, i) in proposal.research"
            :key="i"
            class="grid grid-cols-[14px_minmax(0,1fr)] gap-x-[10px] gap-y-1"
          >
            <span class="ml-1 mt-[9px] size-1 rounded-pill bg-sand" aria-hidden="true" />
            <div class="flex flex-col gap-[6px]">
              <span class="text-body leading-[1.55] [text-wrap:pretty]">{{ r.text }}</span>
              <div class="flex flex-wrap items-center gap-[6px]">
                <SourceChip v-for="(s, j) in r.sources" :key="j" :href="s.url ?? null">{{
                  s.label
                }}</SourceChip>
                <span v-if="r.logLines.length" class="ml-1 text-caption font-semibold text-fg-muted"
                  >Show log lines</span
                >
              </div>
              <div
                v-if="r.evidence.length"
                class="flex flex-col gap-1 rounded-md border border-line bg-base px-[14px] py-3 font-mono text-[11.5px] leading-[1.5] text-fg-muted"
              >
                <div
                  v-for="(e, k) in r.evidence"
                  :key="k"
                  class="grid grid-cols-[130px_230px_minmax(0,1fr)] gap-3"
                >
                  <span>{{ e.timestamp }}</span
                  ><span :class="e.tone === 'bad' ? 'text-brick' : 'text-fg'">{{ e.event }}</span
                  ><span>{{ e.id }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="proposal.conclusion"
          class="rounded-md border border-line bg-base px-4 py-3 text-body leading-[1.55]"
        >
          <span class="font-semibold">Conclusion. </span>{{ proposal.conclusion }}
        </div>
      </div>
    </div>

    <div
      v-if="ticket && ticket.status !== 'closed'"
      class="flex items-center justify-between gap-4 border-t border-line bg-base px-8 py-[14px]"
    >
      <div class="flex items-center gap-2">
        <Button kbd="A">{{
          proposal?.customerConfirmationNeeded
            ? 'Approve stage 1'
            : proposal && proposal.actions.length === 1
              ? 'Approve & send'
              : 'Approve & execute'
        }}</Button>
        <Button variant="secondary" kbd="E">Edit</Button>
        <Button variant="ghost" kbd="R">Reject</Button>
        <Button v-if="ticket.riskLevel !== 'safety'" variant="ghost" kbd="S">Snooze</Button>
      </div>
      <span class="shrink-0 whitespace-nowrap text-right text-caption text-fg-muted">{{
        proposal?.metaLine
      }}</span>
    </div>

    <template #context>
      <div
        v-if="ticket?.customerContext"
        class="grid auto-rows-max content-start gap-6 px-5 pb-7 pt-[22px]"
      >
        <div class="flex flex-col gap-[10px]">
          <Eyebrow>{{ ticket.customerContext.title }}</Eyebrow>
          <KeyValueList :items="ticket.customerContext.plan" />
        </div>
        <div v-if="ticket.customerContext.timeline.length" class="flex flex-col gap-3">
          <Eyebrow>Payments &amp; refunds</Eyebrow>
          <div class="relative flex flex-col">
            <span class="absolute bottom-2 left-1 top-2 w-px bg-line" aria-hidden="true" />
            <div
              v-for="(e, i) in ticket.customerContext.timeline"
              :key="i"
              class="relative grid grid-cols-[9px_minmax(0,1fr)_auto] gap-[10px] py-[5px]"
            >
              <span
                class="mt-1 size-[9px] rounded-pill border-[1.5px]"
                :class="
                  e.kind === 'bad'
                    ? 'border-brick bg-brick'
                    : e.kind === 'muted'
                      ? 'border-sand bg-page'
                      : 'border-ivory bg-page'
                "
              />
              <div class="flex flex-col gap-px">
                <span
                  class="text-small"
                  :class="
                    e.kind === 'bad'
                      ? 'text-brick'
                      : e.kind === 'muted'
                        ? 'text-fg-muted'
                        : 'text-fg'
                  "
                  >{{ e.label }}</span
                >
                <Mono class="text-[11px]">{{ e.date }}</Mono>
              </div>
              <Mono
                :class="
                  e.kind === 'bad' ? 'text-brick' : e.kind === 'muted' ? 'text-fg-muted' : 'text-fg'
                "
                >{{ e.amount }}</Mono
              >
            </div>
          </div>
        </div>
        <div v-if="ticket.customerContext.trackedProfiles.length" class="flex flex-col gap-2">
          <Eyebrow>Tracked profiles</Eyebrow>
          <div
            v-for="p in ticket.customerContext.trackedProfiles"
            :key="p.handle"
            class="flex justify-between gap-[10px] text-small"
          >
            <Mono tone="primary">{{ p.handle }}</Mono
            ><span class="text-caption text-fg-muted">{{ p.meta }}</span>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Eyebrow>Previous tickets</Eyebrow>
          <template v-if="ticket.customerContext.previousTickets.length">
            <NuxtLink
              v-for="p in ticket.customerContext.previousTickets"
              :key="p.id"
              :to="`/anastasai/t/${p.displayNumber}`"
              class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-[10px] text-small text-fg no-underline hover:no-underline"
            >
              <Mono>#{{ p.displayNumber }}</Mono
              ><span class="truncate">{{ p.title }}</span
              ><Mono class="text-[11px]">{{ p.date }}</Mono>
            </NuxtLink>
          </template>
          <span v-else class="text-small text-fg-muted">None</span>
        </div>
        <div class="flex flex-col gap-2">
          <Eyebrow>Log errors</Eyebrow>
          <div
            v-if="ticket.customerContext.logErrors"
            class="flex flex-col gap-[6px] rounded-md border border-line bg-base px-3 py-[10px]"
          >
            <div
              v-for="l in ticket.customerContext.logErrors"
              :key="l.text"
              class="flex justify-between gap-2 font-mono text-[11px] leading-[1.45]"
            >
              <span class="text-fg">{{ l.text }}</span
              ><span class="shrink-0 text-fg-muted">×{{ l.count }}</span>
            </div>
          </div>
          <span v-else class="text-small text-fg-muted">{{
            ticket.customerContext.logErrorsNote ?? 'None'
          }}</span>
        </div>
        <div v-if="ticket.customerContext.tags.length" class="flex flex-col gap-2">
          <Eyebrow>Tags</Eyebrow>
          <div class="flex flex-wrap gap-[6px]">
            <Chip v-for="g in ticket.customerContext.tags" :key="g" variant="tag">{{ g }}</Chip>
          </div>
        </div>
      </div>
      <div v-else class="px-5 pt-[22px] text-small text-fg-muted">No customer context yet.</div>
    </template>
  </ShellColumns>
</template>
