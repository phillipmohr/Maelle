<script setup lang="ts">
/**
 * The 320px list next to a ticket: Inbox title and mailbox, ⌘K search, All / Risk / Billing chips
 * with F for filters, then the groups Needs decision / Waiting on customer / Snoozed with counts.
 */
import type { TicketListItem } from '#shared/api'
import {
  availableTags,
  matchesListFilters,
  type ListFilters,
  type QuickFilter,
} from '~/composables/useInboxFilters'
import {
  listSubline,
  listTag,
  listTime,
  needsDecisionRows,
  researchChecklist,
  rowDot,
  snoozedRows,
  waitingRows,
  customerName,
} from '~/composables/useInboxRows'
import { useShortcuts } from '~/composables/useShortcuts'

const props = defineProps<{
  items: TicketListItem[]
  currentNumber: number | null
  now: Date
  /** Shown under the title (the support mailbox). */
  mailbox: string
}>()
const filters = defineModel<ListFilters>('filters', { required: true })
const filtersOpen = defineModel<boolean>('filtersOpen', { default: false })
const { paletteOpen } = useShortcuts()

const filtered = computed(() => props.items.filter((i) => matchesListFilters(i, filters.value)))
const groups = computed(() => [
  { key: 'needs', name: 'Needs decision', rows: needsDecisionRows(filtered.value) },
  { key: 'waiting', name: 'Waiting on customer', rows: waitingRows(filtered.value) },
  { key: 'snoozed', name: 'Snoozed', rows: snoozedRows(filtered.value) },
])
const tags = computed(() => availableTags(props.items))

function setQuick(q: QuickFilter) {
  filters.value = { ...filters.value, quick: q }
}
</script>

<template>
  <div class="flex flex-col gap-[14px] px-[18px] pb-[14px] pt-5">
    <div class="flex items-baseline justify-between">
      <NuxtLink
        to="/anastasai"
        class="font-serif text-heading leading-none text-fg no-underline hover:no-underline"
        >Inbox</NuxtLink
      >
      <Mono class="text-[11px]">{{ mailbox }}</Mono>
    </div>
    <button
      type="button"
      class="flex items-center justify-between rounded-md border border-line px-[10px] py-2 text-left text-small text-fg-muted transition-fast hover:border-line-strong hover:text-fg"
      @click="paletteOpen = true"
    >
      <span>Search or run a command</span><Kbd keys="⌘K" />
    </button>
    <div class="flex items-center gap-[6px]">
      <Chip
        v-for="q in [
          { v: 'all', l: 'All' },
          { v: 'risk', l: 'Risk' },
          { v: 'billing', l: 'Billing' },
        ] as const"
        :key="q.v"
        variant="filter"
        interactive
        :active="filters.quick === q.v"
        @click="setQuick(q.v)"
        >{{ q.l }}</Chip
      >
      <span class="flex-1" />
      <TicketListFilters v-model="filters" v-model:open="filtersOpen" :tags="tags" />
    </div>
  </div>
  <ScrollArea class="flex-1">
    <template v-for="g in groups" :key="g.key">
      <div class="flex justify-between px-[18px] pb-2 pt-4">
        <Eyebrow as="h2">{{ g.name }}</Eyebrow>
        <Mono class="text-[11px]">{{ g.rows.length }}</Mono>
      </div>
      <div
        v-if="g.rows.length === 0"
        class="border-t border-line py-[10px] pl-10 pr-[18px] text-caption text-fg-muted"
      >
        Clear
      </div>
      <TicketRow
        v-for="t in g.rows"
        :key="t.id"
        :to="`/anastasai/t/${t.displayNumber}`"
        :name="customerName(t)"
        :sub="listSubline(t, now)"
        :time="listTime(t, now)"
        :risk="rowDot(t)"
        :research="t.runProgress ? researchChecklist(t.runProgress) : null"
        :tag="listTag(t)?.text ?? null"
        :tag-tone="listTag(t)?.tone ?? 'brick'"
        :selected="t.displayNumber === currentNumber"
      />
    </template>
  </ScrollArea>
</template>
