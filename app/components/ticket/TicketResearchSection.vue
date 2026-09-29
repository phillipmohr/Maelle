<script setup lang="ts">
/**
 * Research: warning chips, "4 sources · 22s", findings with source chips (open Stripe, Notion,
 * Linear or the ticket), evidence tables in mono, "Show log lines", the conclusion and the
 * "No knowledge found" chip.
 */
import type { AgentRunRow, ProposalRow, TicketUsage } from '#shared/api'
import { researchMeta, sourceLink } from '~/composables/useTicketModel'
import { formatCost } from '~/utils/format'

const props = defineProps<{
  proposal: ProposalRow
  runs: AgentRunRow[]
  /** Every Claude call of the ticket (IRDR-460); the breakdown opens on demand. */
  usage?: TicketUsage | null
  /** Evidence tables open by default (high risk: the evidence is the point). */
  evidenceOpen?: boolean
}>()

const meta = computed(() => researchMeta(props.proposal, props.runs))
const hasUsage = computed(() => (props.usage?.totals.calls ?? 0) > 0)
const costOpen = ref(false)
const open = ref<Record<string, boolean>>({})
function isOpen(kind: 'e' | 'l', i: number): boolean {
  const k = `${kind}${i}`
  return open.value[k] ?? (kind === 'e' ? Boolean(props.evidenceOpen) : false)
}
function toggle(kind: 'e' | 'l', i: number) {
  const k = `${kind}${i}`
  open.value = { ...open.value, [k]: !isOpen(kind, i) }
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="Research">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <Eyebrow as="h2">Research</Eyebrow>
      <div class="flex min-w-0 flex-wrap items-center justify-end gap-[10px]">
        <StatusPill
          v-for="w in proposal.researchWarnings"
          :key="w"
          status="warning"
          class="max-w-full whitespace-normal [overflow-wrap:anywhere]"
          >{{ w }}</StatusPill
        >
        <StatusPill v-if="proposal.noKnowledgeFound" status="neutral"
          >No knowledge found</StatusPill
        >
        <Mono class="text-[11px]">{{ meta }}</Mono>
      </div>
    </div>
    <div class="flex flex-col gap-3">
      <div
        v-for="(r, i) in proposal.research"
        :key="i"
        class="grid grid-cols-[14px_minmax(0,1fr)] gap-x-[10px] gap-y-1"
      >
        <span class="ml-1 mt-[9px] size-1 rounded-pill bg-sand" aria-hidden="true" />
        <div class="flex min-w-0 flex-col gap-[6px]">
          <span class="text-body leading-[1.55] [text-wrap:pretty]">{{ r.text }}</span>
          <div class="flex flex-wrap items-center gap-[6px]">
            <SourceChip
              v-for="(s, j) in r.sources"
              :key="j"
              :href="sourceLink(s).href ?? null"
              :to="sourceLink(s).to ?? null"
              class="max-w-full [overflow-wrap:anywhere]"
              >{{ s.label }}</SourceChip
            >
            <button
              v-if="r.evidence.length"
              type="button"
              class="ml-1 text-caption font-semibold text-fg-muted hover:text-fg"
              :aria-expanded="isOpen('e', i) ? 'true' : 'false'"
              @click="toggle('e', i)"
            >
              {{ isOpen('e', i) ? 'Hide evidence' : `Show evidence · ${r.evidence.length}` }}
            </button>
            <button
              v-if="r.logLines.length"
              type="button"
              class="ml-1 text-caption font-semibold text-fg-muted hover:text-fg"
              :aria-expanded="isOpen('l', i) ? 'true' : 'false'"
              @click="toggle('l', i)"
            >
              {{ isOpen('l', i) ? 'Hide log lines' : 'Show log lines' }}
            </button>
          </div>
          <div
            v-if="r.evidence.length && isOpen('e', i)"
            class="flex flex-col gap-1 overflow-x-auto rounded-md border border-line bg-base px-[14px] py-3 font-mono text-[11.5px] leading-[1.5] text-fg-muted"
          >
            <div
              v-for="(e, k) in r.evidence"
              :key="k"
              class="grid min-w-max grid-cols-[130px_230px_minmax(0,1fr)] gap-3"
            >
              <span>{{ e.timestamp }}</span>
              <span
                :class="
                  e.tone === 'bad' ? 'text-brick' : e.tone === 'muted' ? 'text-fg-muted' : 'text-fg'
                "
                >{{ e.event }}</span
              >
              <span>{{ e.id }}</span>
            </div>
          </div>
          <pre
            v-if="r.logLines.length && isOpen('l', i)"
            class="overflow-auto rounded-md border border-line bg-base px-[14px] py-3 font-mono text-[11.5px] leading-[1.5] text-fg-muted whitespace-pre-wrap"
            >{{ r.logLines.join('\n') }}</pre>
        </div>
      </div>
    </div>
    <div
      v-if="proposal.conclusion"
      class="rounded-md border border-line bg-base px-4 py-3 text-body leading-[1.55]"
    >
      <span class="font-semibold">Conclusion. </span>{{ proposal.conclusion }}
    </div>
    <div v-if="hasUsage" class="flex flex-col gap-3">
      <button
        type="button"
        class="self-start text-caption font-semibold text-fg-muted hover:text-fg"
        :aria-expanded="costOpen ? 'true' : 'false'"
        @click="costOpen = !costOpen"
      >
        {{
          costOpen
            ? 'Hide cost breakdown'
            : `Show cost breakdown · ${formatCost(usage!.totals.costUsd)} on this ticket`
        }}
      </button>
      <TicketCostBreakdown
        v-if="costOpen"
        :usage="usage!"
        :runs="runs"
        :proposal-id="proposal.id"
      />
    </div>
  </section>
</template>
