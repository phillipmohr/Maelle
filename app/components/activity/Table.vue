<script setup lang="ts">
/** Header row, day eyebrows and rows. Entries arrive newest first and are grouped by local day. */
import type { ActivityEntry } from './Row.vue'
import { dayLabel } from '~/utils/format'

const props = defineProps<{ entries: ActivityEntry[]; loading?: boolean }>()

const days = computed(() => {
  const map = new Map<string, ActivityEntry[]>()
  for (const e of props.entries) {
    const key = new Date(e.at).toDateString()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return [...map.entries()]
})
</script>

<template>
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
      <ActivityRow v-for="e in rows" :key="e.id" :entry="e" />
    </template>
    <div
      v-if="entries.length === 0"
      class="border-t border-line px-5 py-6 text-small text-fg-muted"
    >
      {{ loading ? 'Loading…' : 'Nothing ran that matches these filters.' }}
    </div>
  </Panel>
</template>
