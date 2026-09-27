<script setup lang="ts">
/** The last 30 tickets as 30 ticks of 5 × 14 px: sage unchanged, gilt edited, brick rejected, empty. */
import type { CaseTrackRecord } from '#shared/api'
import { TRACK_RECORD_WINDOW } from '#shared/autonomy'

defineProps<{ ticks: CaseTrackRecord['ticks'] }>()

const COLOR: Record<CaseTrackRecord['ticks'][number], string> = {
  unchanged: 'bg-sage',
  edited: 'bg-gilt',
  rejected: 'bg-brick',
}
</script>

<template>
  <div class="flex gap-[2px]" aria-hidden="true">
    <span
      v-for="i in TRACK_RECORD_WINDOW"
      :key="i"
      class="h-[14px] w-[5px] rounded-[1px]"
      :class="ticks[i - 1] ? COLOR[ticks[i - 1]!] : 'bg-umber-700'"
    />
  </div>
</template>
