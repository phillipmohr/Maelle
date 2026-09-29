<script setup lang="ts">
/** Audit trail: every execution and decision of the ticket, in order, in mono. Irreversible in ember. */
import type { ActionExecutionRow, DecisionRow } from '#shared/api'
import { ACTIONS } from '#shared/actions'
import { paramsSummary } from '~/composables/useTicketModel'
import { clockTime, shortDate } from '~/utils/format'

const props = defineProps<{
  executions: ActionExecutionRow[]
  decisions: DecisionRow[]
  now: Date
}>()

const DECISION_LABEL: Record<DecisionRow['decision'], string> = {
  approved: 'Approved',
  approved_with_edits: 'Approved with edits',
  rejected: 'Rejected',
  handled_manually: 'Handled manually',
  snoozed: 'Snoozed',
  marked_done: 'Marked done',
  auto: 'Auto',
}

interface Row {
  key: string
  at: string
  what: string
  detail: string
  by: string
  status: 'success' | 'error' | 'warning' | 'info' | 'neutral'
  statusLabel: string
  irreversible: boolean
  error: string | null
}

const rows = computed<Row[]>(() => {
  const ex: Row[] = props.executions.map((e) => ({
    key: e.id,
    at: e.startedAt ?? e.createdAt,
    what: ACTIONS[e.type].label + (e.attempt > 1 ? ` · attempt ${e.attempt}` : ''),
    detail: paramsSummary(e),
    by: e.executedBy === 'auto' ? 'Auto' : 'You',
    status:
      e.status === 'succeeded'
        ? 'success'
        : e.status === 'failed'
          ? 'error'
          : e.status === 'held'
            ? 'warning'
            : e.status === 'cancelled'
              ? 'neutral'
              : 'info',
    statusLabel:
      e.status === 'succeeded'
        ? e.type === 'send_reply'
          ? 'Sent'
          : 'Succeeded'
        : e.status.charAt(0).toUpperCase() + e.status.slice(1),
    irreversible: e.irreversible,
    error: e.error,
  }))
  const de: Row[] = props.decisions.map((d) => ({
    key: d.id,
    at: d.decidedAt,
    what: `Decision · ${DECISION_LABEL[d.decision]}`,
    detail: [d.rejectReason?.replace(/_/g, ' '), d.note].filter(Boolean).join(' · '),
    by: d.decision === 'auto' ? 'Auto' : 'You',
    status: 'neutral',
    statusLabel:
      d.timeToDecideMs != null ? `${Math.round(d.timeToDecideMs / 1000)}s to decide` : 'Recorded',
    irreversible: false,
    error: null,
  }))
  return [...ex, ...de].sort((a, b) => a.at.localeCompare(b.at))
})
</script>

<template>
  <Panel id="audit-trail" as="section" aria-label="Audit trail" class="scroll-mt-14">
    <PanelHeader title="Audit trail" :meta="`${rows.length} entries`" eyebrow />
    <div class="divide-hairline">
      <div
        v-for="r in rows"
        :key="r.key"
        class="grid grid-cols-[110px_minmax(0,1.2fr)_minmax(0,1.3fr)_50px_auto] items-center gap-x-[18px] gap-y-1 px-[18px] py-[10px]"
      >
        <Mono class="text-[11px]">{{ shortDate(r.at, now) }} {{ clockTime(r.at) }}</Mono>
        <span
          class="flex items-center gap-[6px] text-small font-semibold"
          :class="r.irreversible ? 'text-ember' : 'text-fg'"
          ><LockShape v-if="r.irreversible" />{{ r.what }}</span
        >
        <Mono class="truncate">{{ r.detail }}</Mono>
        <span class="flex items-center gap-2 text-small"
          ><RiskDot v-if="r.by === 'Auto'" kind="auto" />{{ r.by }}</span
        >
        <StatusPill :status="r.status" :dot="r.status !== 'neutral'">{{
          r.statusLabel
        }}</StatusPill>
        <span v-if="r.error" class="col-span-5 font-mono text-[11.5px] text-brick">{{
          r.error
        }}</span>
      </div>
    </div>
  </Panel>
</template>
