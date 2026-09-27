<script setup lang="ts">
/** Activity log. Owner: IRDR-459 (screen 2c). Foundation placeholder over the stubbed route. */
import type { ActivityResponse } from '#shared/api'
import { actionLabel } from '#shared/actions'
import { clockTime, dayLabel } from '~/utils/format'

useHead({ title: 'Activity log' })
const filter = ref<'all' | 'you' | 'auto'>('all')
const { data } = await useFetch<ActivityResponse>('/api/activity', { key: 'activity' })
const items = computed(() =>
  (data.value?.items ?? []).filter((i) => filter.value === 'all' || i.executedBy === filter.value),
)
const days = computed(() => {
  const map = new Map<string, typeof items.value>()
  for (const i of items.value) {
    const d = new Date(i.createdAt).toDateString()
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(i)
  }
  return [...map.entries()]
})
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-6 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex max-w-[640px] flex-col gap-[10px]">
        <h1 class="type-display">Activity log</h1>
        <p class="text-body text-fg-muted">
          Every action that ran, in order. Irreversible actions in ember.
        </p>
      </div>
      <div class="flex items-center gap-[10px]">
        <SegmentedControl
          v-model="filter"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'you', label: 'You' },
            { value: 'auto', label: 'Auto' },
          ]"
          aria-label="Filter by who ran it"
        />
        <Button variant="secondary" size="sm" to="/api/activity/export.csv">Export CSV</Button>
      </div>
    </div>
    <Panel>
      <div
        class="grid grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1.3fr)_70px_80px_120px] gap-[18px] px-5 py-3 type-eyebrow text-fg-muted"
      >
        <span>Time</span><span>Action</span><span>Parameters</span><span>Ticket</span><span>By</span
        ><span>Result</span>
      </div>
      <template v-for="[day, rows] in days" :key="day">
        <div class="border-t border-line bg-page px-5 pb-2 pt-[14px]">
          <Eyebrow>{{ dayLabel(day) }}</Eyebrow>
        </div>
        <div
          v-for="r in rows"
          :key="r.id"
          class="grid grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1.3fr)_70px_80px_120px] items-center gap-x-[18px] gap-y-[6px] border-t border-line px-5 py-[11px]"
        >
          <Mono>{{ clockTime(r.createdAt) }}</Mono>
          <span
            class="flex items-center text-body font-semibold"
            :class="r.irreversible ? 'text-ember' : 'text-fg'"
            ><LockShape v-if="r.irreversible" class="mr-[6px]" />{{ actionLabel(r.type) }}</span
          >
          <Mono class="truncate">{{ Object.values(r.params).map(String).join(' · ') }}</Mono>
          <NuxtLink
            :to="`/anastasai/t/${r.ticketDisplayNumber}`"
            class="font-mono text-caption text-fg-muted"
            >#{{ r.ticketDisplayNumber }}</NuxtLink
          >
          <span class="flex items-center gap-2 text-small"
            ><RiskDot v-if="r.executedBy === 'auto'" kind="auto" />{{
              r.executedBy === 'auto' ? 'Auto' : 'You'
            }}</span
          >
          <StatusPill
            :status="
              r.status === 'succeeded'
                ? 'success'
                : r.status === 'failed'
                  ? 'error'
                  : r.status === 'held'
                    ? 'warning'
                    : 'info'
            "
          >
            {{
              r.status === 'succeeded'
                ? r.type === 'send_reply'
                  ? 'Sent'
                  : 'Succeeded'
                : r.status === 'failed'
                  ? 'Failed'
                  : r.status === 'held'
                    ? 'Held'
                    : r.status
            }}
          </StatusPill>
          <span v-if="r.error" class="col-start-2 col-end-7 font-mono text-[11.5px] text-brick">{{
            r.error
          }}</span>
        </div>
      </template>
    </Panel>
  </div>
</template>
