<script setup lang="ts">
/** The four headline numbers of the window: spend, per ticket, calls, cache share. */
import type { UsageResponse } from '#shared/api'
import { cacheShare, totalInputTokens } from '#shared/usage'
import { formatCost, formatTokens, percent, plural } from '~/utils/format'

const props = defineProps<{ data: UsageResponse }>()

const tiles = computed(() => {
  const t = props.data.totals
  const perTicket =
    props.data.tickets > 0 && t.costUsd != null ? t.costUsd / props.data.tickets : null
  return [
    {
      label: `Spend · last ${props.data.days} days`,
      value: formatCost(t.costUsd, { compact: true }),
      sub: `${formatTokens(totalInputTokens(t) + t.outputTokens, { compact: true })} tokens`,
    },
    {
      label: 'Per ticket',
      value: formatCost(perTicket),
      sub: `${plural(props.data.tickets, 'ticket')} with calls`,
    },
    {
      label: 'Calls',
      value: formatTokens(t.calls),
      sub: `${plural(props.data.runs, 'agent run')}`,
    },
    {
      label: 'Read from cache',
      value: percent(cacheShare(t)),
      sub: 'of the input tokens',
    },
  ]
})
</script>

<template>
  <div class="grid grid-cols-4 gap-4">
    <Panel v-for="tile in tiles" :key="tile.label" :padding="18" class="flex flex-col gap-1">
      <span class="text-caption text-fg-muted">{{ tile.label }}</span>
      <span
        class="font-sans text-heading font-semibold text-fg [font-variant-numeric:proportional-nums]"
        >{{ tile.value }}</span
      >
      <span class="font-mono text-[11px] text-fg-muted">{{ tile.sub }}</span>
    </Panel>
  </div>
</template>
