<script setup lang="ts">
/** All / You / Auto, "Irreversible only", Export CSV (the same filters). */
import type { ExecutedBy } from '#shared/api'

const props = defineProps<{
  by: ExecutedBy | 'all'
  irreversibleOnly: boolean
  exportHref: string
}>()
const emit = defineEmits<{
  'update:by': [by: ExecutedBy | 'all']
  'update:irreversibleOnly': [value: boolean]
}>()

function exportCsv() {
  navigateTo(props.exportHref, { external: true })
}
</script>

<template>
  <div class="flex items-center gap-[10px]">
    <SegmentedControl
      :model-value="by"
      :options="[
        { value: 'all', label: 'All' },
        { value: 'you', label: 'You' },
        { value: 'auto', label: 'Auto' },
      ]"
      aria-label="Filter by who ran it"
      @update:model-value="(v) => emit('update:by', v as ExecutedBy | 'all')"
    />
    <Chip
      variant="filter"
      interactive
      :active="irreversibleOnly"
      @click="emit('update:irreversibleOnly', !irreversibleOnly)"
      ><span class="flex items-center gap-[6px]"
        ><LockShape
          :color="irreversibleOnly ? 'var(--ember-400)' : 'var(--sand-400)'"
        />Irreversible only</span
      ></Chip
    >
    <Button variant="secondary" size="sm" @click="exportCsv">Export CSV</Button>
  </div>
</template>
