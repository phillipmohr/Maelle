<script setup lang="ts">
/** The F popover of the ticket list: status, case, risk, needs confirmation, customer tags, date. */
import { CASE_TYPE_LIST } from '#shared/case-types'
import { TICKET_STATUS_LABELS, type TicketStatus } from '#shared/status'
import {
  activeFilterCount,
  defaultListFilters,
  type ListFilters,
} from '~/composables/useInboxFilters'

const props = defineProps<{ tags: string[] }>()
const filters = defineModel<ListFilters>({ required: true })
const open = defineModel<boolean>('open', { default: false })

const STATUSES: TicketStatus[] = [
  'needs_decision',
  'researching',
  'action_failed',
  'executing',
  'waiting_on_customer',
  'snoozed',
  'manual',
  'auto_pending',
]

function toggle<K extends 'statuses' | 'caseTypes' | 'risk' | 'tags'>(
  key: K,
  value: ListFilters[K][number],
) {
  const list = filters.value[key] as unknown[]
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  filters.value = { ...filters.value, [key]: next }
}
function setDate(key: 'from' | 'to', v: string) {
  filters.value = { ...filters.value, [key]: v || null }
}
const count = computed(() => activeFilterCount(filters.value))
const tags = computed(() => props.tags)
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex items-center gap-[6px] rounded-sm text-caption text-fg-muted hover:text-fg"
        :aria-label="count > 0 ? `Filters (${count} active)` : 'Filters'"
      >
        <span v-if="count > 0" class="font-mono text-[11px] text-fg">{{ count }}</span>
        <Kbd keys="F" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-[300px]">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Eyebrow>Status</Eyebrow>
          <div class="grid grid-cols-2 gap-x-3 gap-y-[6px]">
            <label v-for="s in STATUSES" :key="s" class="flex items-center gap-2 text-caption">
              <Checkbox
                :model-value="filters.statuses.includes(s)"
                @update:model-value="toggle('statuses', s)"
              />{{ TICKET_STATUS_LABELS[s] }}
            </label>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Eyebrow>Risk</Eyebrow>
          <div class="flex gap-[6px]">
            <Chip
              v-for="r in ['safety', 'high', 'none'] as const"
              :key="r"
              variant="filter"
              interactive
              :active="filters.risk.includes(r)"
              @click="toggle('risk', r)"
              >{{ r === 'none' ? 'Routine' : r === 'high' ? 'High' : 'Safety' }}</Chip
            >
            <Chip
              variant="filter"
              interactive
              :active="filters.needsConfirmation"
              @click="filters = { ...filters, needsConfirmation: !filters.needsConfirmation }"
              >Needs confirmation</Chip
            >
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Eyebrow>Case</Eyebrow>
          <div class="flex flex-wrap gap-[6px]">
            <Chip
              v-for="c in CASE_TYPE_LIST"
              :key="c.key"
              variant="filter"
              interactive
              :active="filters.caseTypes.includes(c.key)"
              @click="toggle('caseTypes', c.key)"
              >{{ c.shortLabel }}</Chip
            >
          </div>
        </div>
        <div v-if="tags.length" class="flex flex-col gap-2">
          <Eyebrow>Customer tags</Eyebrow>
          <div class="flex flex-wrap gap-[6px]">
            <Chip
              v-for="t in tags"
              :key="t"
              variant="filter"
              interactive
              :active="filters.tags.includes(t)"
              @click="toggle('tags', t)"
              >{{ t }}</Chip
            >
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <Eyebrow>Last message</Eyebrow>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1 text-caption text-fg-muted"
              >From
              <Input
                type="date"
                :model-value="filters.from ?? ''"
                @update:model-value="(v) => setDate('from', v)"
            /></label>
            <label class="flex flex-col gap-1 text-caption text-fg-muted"
              >To
              <Input
                type="date"
                :model-value="filters.to ?? ''"
                @update:model-value="(v) => setDate('to', v)"
            /></label>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <Button variant="ghost" size="sm" @click="filters = defaultListFilters()">Reset</Button>
          <Button variant="secondary" size="sm" kbd="Esc" @click="open = false">Done</Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
