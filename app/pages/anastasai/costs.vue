<script setup lang="ts">
/** Costs page (IRDR-460): what Claude costs per day, per purpose, per tool and per ticket. */
import type { UsageResponse } from '#shared/api'

useHead({ title: 'Costs' })

const days = ref<'7' | '30' | '90'>('30')
const query = computed(() => ({ days: Number(days.value) }))
const { data, status } = await useFetch<UsageResponse>('/api/usage', { key: 'usage', query })
const options = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex max-w-[640px] flex-col gap-[10px]">
        <h1 class="type-display">Costs</h1>
        <p class="text-body text-fg-muted [text-wrap:pretty]">
          What Claude costs: every call is recorded with its tokens and priced at the time it ran.
          Per day, per purpose, per tool and per ticket.
        </p>
      </div>
      <SegmentedControl
        :model-value="days"
        :options="options"
        aria-label="Window"
        @update:model-value="(v) => (days = v as typeof days)"
      />
    </div>

    <template v-if="data">
      <div :class="status === 'pending' ? 'opacity-60 transition-fast' : ''" class="grid gap-7">
        <CostsTiles :data="data" />
        <CostsDailyChart :series="data.series" :days="data.days" />
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
          <CostsBreakdown :data="data" />
          <CostsTools :tools="data.tools" />
        </div>
        <CostsTopTickets :tickets="data.topTickets" />
      </div>
      <p class="text-caption text-fg-muted">
        Prices per model live in <Mono>shared/pricing.ts</Mono>; a call on a model without a price
        shows its tokens only. Every ticket has its own breakdown under Research.
      </p>
    </template>
  </div>
</template>
