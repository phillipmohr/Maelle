<script setup lang="ts">
/** Cost by purpose (agent runs, consistency checks, KB drafts) and by model, with a share bar. */
import type { UsageResponse, UsageTotals } from '#shared/api'
import { MODEL_CALL_PURPOSES, PURPOSE_LABEL, totalInputTokens } from '#shared/usage'
import { formatCost, formatTokens, percent } from '~/utils/format'

const props = defineProps<{ data: UsageResponse }>()

interface Row {
  key: string
  label: string
  totals: UsageTotals
  share: number | null
}

function share(t: UsageTotals): number | null {
  const all = props.data.totals.costUsd
  return all && t.costUsd != null ? t.costUsd / all : null
}

const byPurpose = computed<Row[]>(() =>
  MODEL_CALL_PURPOSES.filter((p) => props.data.byPurpose[p]).map((p) => ({
    key: p,
    label: PURPOSE_LABEL[p],
    totals: props.data.byPurpose[p]!,
    share: share(props.data.byPurpose[p]!),
  })),
)
const byModel = computed<Row[]>(() =>
  props.data.byModel.map((m) => ({
    key: m.model,
    label: m.model,
    totals: m.totals,
    share: share(m.totals),
  })),
)
</script>

<template>
  <Panel>
    <PanelHeader title="By purpose" eyebrow :meta="formatCost(data.totals.costUsd)" />
    <div class="divide-hairline">
      <div
        v-for="r in byPurpose"
        :key="r.key"
        class="grid grid-cols-[minmax(0,1fr)_60px_90px_72px] items-center gap-x-4 px-[18px] py-[11px]"
      >
        <div class="flex flex-col gap-[6px]">
          <span class="text-small font-semibold">{{ r.label }}</span>
          <span
            class="h-[4px] w-full overflow-hidden rounded-[1px] bg-umber-700"
            aria-hidden="true"
          >
            <span
              class="block h-full rounded-[1px] bg-gilt"
              :style="{ width: `${Math.round((r.share ?? 0) * 100)}%` }"
            />
          </span>
        </div>
        <Mono class="text-right text-[11px]">{{ r.totals.calls }} calls</Mono>
        <Mono class="text-right text-[11px]"
          >{{
            formatTokens(totalInputTokens(r.totals) + r.totals.outputTokens, { compact: true })
          }}
          tok</Mono
        >
        <span class="text-right font-mono text-caption text-fg"
          >{{ formatCost(r.totals.costUsd) }}
          <span class="text-fg-muted">{{ r.share == null ? '' : percent(r.share) }}</span></span
        >
      </div>
      <div v-if="byPurpose.length === 0" class="px-[18px] py-5 text-small text-fg-muted">
        No calls in this window.
      </div>
    </div>
    <div class="border-t border-line px-[18px] py-3"><Eyebrow>By model</Eyebrow></div>
    <div class="divide-hairline border-t border-line">
      <div
        v-for="r in byModel"
        :key="r.key"
        class="grid grid-cols-[minmax(0,1fr)_60px_90px_72px] items-center gap-x-4 px-[18px] py-[9px]"
      >
        <Mono class="truncate text-[11.5px] text-fg">{{ r.label }}</Mono>
        <Mono class="text-right text-[11px]">{{ r.totals.calls }} calls</Mono>
        <Mono class="text-right text-[11px]"
          >{{ formatTokens(totalInputTokens(r.totals), { compact: true }) }} in ·
          {{ formatTokens(r.totals.outputTokens, { compact: true }) }} out</Mono
        >
        <span class="text-right font-mono text-caption text-fg">{{
          formatCost(r.totals.costUsd)
        }}</span>
      </div>
    </div>
  </Panel>
</template>
