<script setup lang="ts">
/**
 * Cost breakdown of a ticket (IRDR-460): every agent run with its turns and tool calls, then the
 * single calls (consistency checks, KB drafts), then the ticket total. Opens from the Research
 * section on demand so the default view stays a single number.
 */
import type { AgentRunRow, ModelCallRow, TicketUsage, ToolCallRow } from '#shared/api'
import { PURPOSE_LABEL } from '#shared/usage'
import { toolCallLine, triggerLabel, usageView } from '~/composables/useTicketModel'
import { clockTime, duration, formatCost, formatTokens, plural, shortDate } from '~/utils/format'

const props = defineProps<{
  usage: TicketUsage
  runs: AgentRunRow[]
  proposalId: string | null
}>()

const view = computed(() => usageView(props.usage, props.runs, props.proposalId))
const now = new Date()

function inLabel(c: ModelCallRow): string {
  const cached = c.cacheReadTokens + c.cacheCreationTokens
  return cached > 0
    ? `${formatTokens(c.inputTokens)} +${formatTokens(cached, { compact: true })} cached`
    : formatTokens(c.inputTokens)
}
function contextLabel(t: ToolCallRow): string {
  if (t.contextTokens == null) return '–'
  return `${t.contextMeasured ? '' : '≈ '}${formatTokens(t.contextTokens)}`
}
function statusLabel(c: ModelCallRow): string | null {
  if (c.status === 'error') return c.error ? `error · ${c.error}` : 'error'
  if (c.status === 'refusal') return 'refused'
  return null
}
</script>

<template>
  <div
    class="flex flex-col overflow-hidden rounded-md border border-line bg-base font-mono text-[11.5px] leading-[1.5] text-fg-muted"
    aria-label="Cost breakdown"
  >
    <div
      class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] gap-x-3 border-b border-line px-[14px] py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.14em]"
    >
      <span>Call</span><span class="text-right">Tokens in</span><span class="text-right">Out</span
      ><span class="text-right">Time</span><span class="text-right">Cost</span>
    </div>

    <template v-for="run in view.runs" :key="run.runId">
      <div
        class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] items-center gap-x-3 border-b border-line bg-elevated/40 px-[14px] py-[7px] text-fg"
      >
        <span class="flex min-w-0 flex-col gap-px">
          <span class="flex items-center gap-2 font-sans text-caption font-semibold">
            <span
              v-if="run.current"
              class="size-[6px] shrink-0 rotate-45 bg-gilt"
              aria-label="Current proposal"
            />
            {{ triggerLabel(run.trigger) }} · {{ plural(run.turns.length, 'turn')
            }}{{ run.attempt && run.attempt > 1 ? ` · attempt ${run.attempt}` : '' }}
          </span>
          <span class="truncate text-[11px] text-fg-muted"
            >{{ run.model }} · {{ shortDate(run.startedAt, now) }}
            {{ clockTime(run.startedAt) }}</span
          >
        </span>
        <span class="text-right">{{ formatTokens(run.totals.inputTokens) }}</span>
        <span class="text-right">{{ formatTokens(run.totals.outputTokens) }}</span>
        <span />
        <span class="text-right font-semibold">{{ formatCost(run.totals.costUsd) }}</span>
      </div>
      <template v-for="t in run.turns" :key="t.call.id">
        <div
          class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] gap-x-3 px-[14px] py-[5px]"
          :class="t.call.status !== 'ok' ? 'text-brick' : ''"
        >
          <span class="truncate"
            >Turn {{ t.turn
            }}<template v-if="statusLabel(t.call)"> · {{ statusLabel(t.call) }}</template></span
          >
          <span class="text-right">{{ inLabel(t.call) }}</span>
          <span class="text-right">{{ formatTokens(t.call.outputTokens) }}</span>
          <span class="text-right">{{ duration(t.call.durationMs) }}</span>
          <span class="text-right text-fg">{{ formatCost(t.call.costUsd) }}</span>
        </div>
        <div
          v-for="tool in t.tools"
          :key="tool.id"
          class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] gap-x-3 px-[14px] py-[3px]"
          :class="tool.ok ? '' : 'text-brick'"
        >
          <span class="truncate pl-4" :title="toolCallLine(tool)"
            >↳ {{ toolCallLine(tool) }}{{ tool.ok ? '' : ' · failed' }}</span
          >
          <span class="text-right" :title="`${formatTokens(tool.resultChars)} characters returned`"
            >{{ contextLabel(tool) }} ctx</span
          >
          <span />
          <span class="text-right">{{ duration(tool.durationMs) }}</span>
          <span />
        </div>
      </template>
    </template>

    <div
      v-for="c in view.others"
      :key="c.id"
      class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] items-center gap-x-3 border-t border-line px-[14px] py-[6px]"
      :class="c.status !== 'ok' ? 'text-brick' : ''"
    >
      <span class="truncate">
        <span class="font-sans text-caption font-semibold text-fg">{{
          PURPOSE_LABEL[c.purpose].replace(/s$/, '')
        }}</span>
        · {{ c.model }} · {{ shortDate(c.createdAt, now) }} {{ clockTime(c.createdAt)
        }}<template v-if="statusLabel(c)"> · {{ statusLabel(c) }}</template>
      </span>
      <span class="text-right">{{ inLabel(c) }}</span>
      <span class="text-right">{{ formatTokens(c.outputTokens) }}</span>
      <span class="text-right">{{ duration(c.durationMs) }}</span>
      <span class="text-right text-fg">{{ formatCost(c.costUsd) }}</span>
    </div>

    <div
      class="grid grid-cols-[minmax(0,1fr)_140px_56px_40px_60px] items-center gap-x-3 border-t border-line px-[14px] py-[8px] text-fg"
    >
      <span class="truncate font-sans text-caption font-semibold"
        >Ticket total
        <span class="font-normal text-fg-muted"
          >· {{ plural(view.totals.calls, 'call') }}</span
        ></span
      >
      <span class="text-right">{{
        formatTokens(
          view.totals.inputTokens + view.totals.cacheReadTokens + view.totals.cacheCreationTokens,
        )
      }}</span>
      <span class="text-right">{{ formatTokens(view.totals.outputTokens) }}</span>
      <span />
      <span class="text-right font-semibold">{{ formatCost(view.totals.costUsd) }}</span>
    </div>
    <p class="border-t border-line px-[14px] py-2 font-sans text-[11px] text-fg-muted">
      Tokens in: uncached + read from or written to the cache. ctx = tokens a tool result added to
      the context, measured on the next turn; ≈ marks an estimate. Priced at the time of the call.
    </p>
  </div>
</template>
