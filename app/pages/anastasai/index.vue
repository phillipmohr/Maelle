<script setup lang="ts">
/**
 * Inbox. Owner: IRDR-458 (screens 3a and 3b). This foundation placeholder lists the seed tickets
 * with the shared components so the shell, shortcuts and data flow can be verified.
 */
import { caseShortLabel } from '#shared/case-types'
import { ageShort, clockTime } from '~/utils/format'
import { useTicketList } from '~/composables/useTickets'
import { useShortcuts, useShortcutScope } from '~/composables/useShortcuts'

useHead({ title: 'Inbox' })
useShortcutScope('inbox')

const { data } = useTicketList()
const open = computed(() =>
  (data.value?.items ?? [])
    .filter((t) =>
      ['new', 'researching', 'needs_decision', 'executing', 'action_failed', 'manual'].includes(
        t.status,
      ),
    )
    .sort((a, b) => {
      const rank = (r: string) => (r === 'safety' ? 0 : r === 'high' ? 1 : 2)
      return rank(a.riskLevel) - rank(b.riskLevel) || a.createdAt.localeCompare(b.createdAt)
    }),
)
const closed = computed(() => (data.value?.items ?? []).filter((t) => t.status === 'closed'))
const selected = ref(0)

const { register } = useShortcuts()
register([
  {
    id: 'inbox.next',
    keys: 'j',
    label: 'Next ticket',
    group: 'Inbox',
    scope: 'inbox',
    handler: () => (selected.value = Math.min(selected.value + 1, open.value.length - 1)),
  },
  {
    id: 'inbox.prev',
    keys: 'k',
    label: 'Previous ticket',
    group: 'Inbox',
    scope: 'inbox',
    handler: () => (selected.value = Math.max(selected.value - 1, 0)),
  },
  {
    id: 'inbox.open',
    keys: 'enter',
    label: 'Open ticket',
    group: 'Inbox',
    scope: 'inbox',
    handler: () => {
      const t = open.value[selected.value]
      if (t) navigateTo(`/anastasai/t/${t.displayNumber}`)
    },
  },
])

function pill(t: (typeof open.value)[number]): {
  status: 'draft' | 'info' | 'warning' | 'error' | 'success'
  label: string
} {
  if (t.status === 'researching') return { status: 'info', label: 'Researching' }
  if (t.status === 'action_failed') return { status: 'error', label: '1 action failed' }
  if (t.riskLevel === 'high') return { status: 'warning', label: 'High risk' }
  if (t.riskLevel === 'safety') return { status: 'warning', label: 'Safety' }
  if (t.stage === 1 && t.caseType === 'refund_request')
    return { status: 'info', label: 'Needs confirmation' }
  return { status: 'draft', label: 'Needs decision' }
}
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex flex-col gap-[10px]">
        <h1 class="type-display">Inbox</h1>
        <p class="text-body text-fg-muted">
          {{ data?.counts.needsDecision ?? 0 }} need your decision ·
          {{ data?.counts.closedLast3Days ?? 0 }} closed in the last 3 days
        </p>
      </div>
      <button
        type="button"
        class="flex w-[320px] items-center justify-between gap-6 rounded-md border border-line px-[10px] py-2 text-left text-small text-fg-muted hover:border-line-strong"
        @click="useShortcuts().paletteOpen.value = true"
      >
        <span>Search all tickets</span><Kbd keys="⌘K" />
      </button>
    </div>

    <Panel elevation="focus">
      <div class="flex items-center justify-between px-5 py-4">
        <Eyebrow tone="accent">Needs decision</Eyebrow>
        <span class="flex items-center gap-[6px] text-caption text-fg-muted"
          >Open first <Kbd keys="⏎"
        /></span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-[84px]">Ticket</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Case</TableHead>
            <TableHead class="w-[190px]">Status</TableHead>
            <TableHead class="w-[36%]">Proposal</TableHead>
            <TableHead class="w-[72px]">Age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="(t, i) in open"
            :key="t.id"
            interactive
            :selected="i === selected"
            :tint="t.riskLevel === 'high' || t.riskLevel === 'safety' ? 'ember' : 'none'"
            @click="navigateTo(`/anastasai/t/${t.displayNumber}`)"
          >
            <TableCell>
              <span class="flex items-center gap-[10px]">
                <RiskDot
                  :kind="
                    t.status === 'researching'
                      ? 'research'
                      : t.status === 'action_failed'
                        ? 'failed'
                        : t.riskLevel === 'none'
                          ? 'none'
                          : t.riskLevel
                  "
                />
                <Mono>#{{ t.displayNumber }}</Mono>
              </span>
            </TableCell>
            <TableCell>
              <div class="flex min-w-0 flex-col gap-px">
                <span class="truncate text-body font-semibold">{{
                  t.customerName ?? t.customerEmail
                }}</span>
                <Mono class="truncate text-[11px]">{{ t.customerEmail }}</Mono>
              </div>
            </TableCell>
            <TableCell>{{ t.caseType ? caseShortLabel(t.caseType) : 'Classifying…' }}</TableCell>
            <TableCell
              ><StatusPill :status="pill(t).status">{{ pill(t).label }}</StatusPill></TableCell
            >
            <TableCell :class="t.status === 'researching' ? 'text-fg-muted' : 'text-fg'">
              <span class="text-body leading-[1.45] [text-wrap:pretty]">{{
                t.proposalLine ?? 'Researching · classifying the case'
              }}</span>
              <span v-if="t.runProgress" class="mt-1 block font-mono text-[11px] text-fg-muted">
                <template v-for="(v, k) in t.runProgress" :key="k"
                  >{{ String(k) }}
                  {{
                    v === 'ok' ? '✓' : v === 'pending' ? '⋯' : v === 'failed' ? '×' : '·'
                  }}&nbsp;&nbsp;</template
                >
              </span>
            </TableCell>
            <TableCell mono>{{ ageShort(t.createdAt) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Panel>

    <Panel id="closed">
      <div class="flex items-center justify-between px-5 py-[14px]">
        <Eyebrow>Closed</Eyebrow>
        <span class="text-caption text-fg-muted"
          >{{ closed.length }} tickets · full table in IRDR-458</span
        >
      </div>
      <div class="divide-hairline">
        <div
          v-for="t in closed"
          :key="t.id"
          class="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_190px_minmax(0,1.5fr)_72px] items-center gap-[18px] px-5 py-3"
        >
          <Mono class="pl-[17px]">#{{ t.displayNumber }}</Mono>
          <div class="flex min-w-0 flex-col gap-px">
            <span class="truncate text-body font-semibold">{{ t.customerName }}</span>
            <Mono class="truncate text-[11px]">{{ t.customerEmail }}</Mono>
          </div>
          <span class="text-small">{{ t.caseType ? caseShortLabel(t.caseType) : '' }}</span>
          <StatusPill
            v-if="t.resolution && t.resolution !== 'handled_manually'"
            :status="
              t.resolution === 'rejected'
                ? 'error'
                : t.resolution === 'approved_with_edits'
                  ? 'info'
                  : t.resolution === 'auto'
                    ? 'draft'
                    : 'success'
            "
          >
            {{
              {
                approved: 'Approved',
                approved_with_edits: 'Approved with edits',
                rejected: 'Rejected',
                auto: 'Auto',
                marked_done: 'Marked done',
                closed_no_reply: 'Closed',
              }[t.resolution]
            }}
          </StatusPill>
          <Chip v-else variant="filter">Handled manually</Chip>
          <span class="text-caption leading-[1.45] text-fg-muted">{{ t.whatRan }}</span>
          <Mono class="text-[11px]">{{ t.closedAt ? clockTime(t.closedAt) : '' }}</Mono>
        </div>
      </div>
    </Panel>
  </div>
</template>
