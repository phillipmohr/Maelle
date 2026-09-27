<script setup lang="ts">
/**
 * Closed (history): filters All / Approved / Edited / Rejected / Manual / Auto, F for case and date
 * range, columns Ticket · Customer · Case · Decision · What ran · Closed, grouped by day, older rows
 * load as you scroll. A row opens the ticket read-only.
 */
import type { TicketListItem } from '#shared/api'
import { CASE_TYPE_LIST, caseShortLabel } from '#shared/case-types'
import {
  CLOSED_CHIPS,
  closedFilterCount,
  rangeLabel,
  type ClosedRange,
  type ClosedTableFilters,
} from '~/composables/useInboxFilters'
import { caseText, customerName, dayGroups, decisionPill } from '~/composables/useInboxRows'
import { clockTime } from '~/utils/format'

const props = defineProps<{
  items: TicketListItem[]
  now: Date
  hasMore: boolean
  loadingMore: boolean
  pending?: boolean
}>()
const emit = defineEmits<{ loadMore: []; open: [item: TicketListItem] }>()
const filters = defineModel<ClosedTableFilters>('filters', { required: true })
const filtersOpen = defineModel<boolean>('filtersOpen', { default: false })

const groups = computed(() => dayGroups(props.items, props.now))
const GRID =
  'grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_190px_minmax(0,1.5fr)_72px] gap-[18px] px-5'

const RANGES: { value: ClosedRange; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
]

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (!('IntersectionObserver' in window)) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && props.hasMore && !props.loadingMore)
        emit('loadMore')
    },
    { rootMargin: '200px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

function setChip(value: ClosedTableFilters['chip']) {
  filters.value = { ...filters.value, chip: value }
}
function setCase(caseType: ClosedTableFilters['caseType']) {
  filters.value = { ...filters.value, caseType }
}
function setRange(range: ClosedRange) {
  filters.value = { ...filters.value, range }
}
function setDate(key: 'from' | 'to', v: string) {
  filters.value = { ...filters.value, range: 'custom', [key]: v || null }
}
</script>

<template>
  <Panel id="closed" as="section" aria-label="Closed tickets" class="scroll-mt-4">
    <div class="flex items-center justify-between gap-4 px-5 py-[14px]">
      <Eyebrow as="h2">Closed</Eyebrow>
      <div class="flex items-center gap-[6px] text-caption text-fg-muted">
        <Chip
          v-for="c in CLOSED_CHIPS"
          :key="c.value"
          variant="filter"
          interactive
          :active="filters.chip === c.value"
          @click="setChip(c.value)"
          >{{ c.label }}</Chip
        >
        <span class="w-2" />
        <Popover v-model:open="filtersOpen">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="flex items-center gap-[6px] rounded-sm text-caption text-fg-muted hover:text-fg"
              aria-label="More filters"
            >
              <span v-if="closedFilterCount(filters) > 0" class="text-fg"
                >{{ filters.caseType ? caseShortLabel(filters.caseType) : '' }}
                {{ filters.range !== 'all' ? rangeLabel(filters) : '' }}</span
              >
              <Kbd keys="F" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-[420px]">
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-2">
                <Eyebrow>Case</Eyebrow>
                <div class="flex flex-wrap gap-[6px]">
                  <Chip
                    variant="filter"
                    interactive
                    :active="!filters.caseType"
                    @click="setCase(null)"
                    >Any</Chip
                  >
                  <Chip
                    v-for="c in CASE_TYPE_LIST"
                    :key="c.key"
                    variant="filter"
                    interactive
                    :active="filters.caseType === c.key"
                    @click="setCase(c.key)"
                    >{{ c.shortLabel }}</Chip
                  >
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <Eyebrow>Closed</Eyebrow>
                <div class="flex flex-wrap gap-[6px]">
                  <Chip
                    v-for="r in RANGES"
                    :key="r.value"
                    variant="filter"
                    interactive
                    :active="filters.range === r.value"
                    @click="setRange(r.value)"
                    >{{ r.label }}</Chip
                  >
                </div>
                <div v-if="filters.range === 'custom'" class="grid grid-cols-2 gap-2 pt-1">
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
              <div class="flex items-center justify-between text-caption text-fg-muted">
                <span>Search covers everything <Kbd keys="⌘K" /></span>
                <Button variant="ghost" size="sm" kbd="Esc" @click="filtersOpen = false"
                  >Done</Button
                >
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
    <div :class="[GRID, 'border-t border-line py-[10px] type-eyebrow text-fg-muted']" role="row">
      <span>Ticket</span><span>Customer</span><span>Case</span><span>Decision</span
      ><span>What ran</span><span>Closed</span>
    </div>
    <template v-for="g in groups" :key="g.day">
      <div class="border-t border-line bg-page px-5 pb-2 pt-[14px]">
        <Eyebrow as="h3">{{ g.day }}</Eyebrow>
      </div>
      <NuxtLink
        v-for="t in g.rows"
        :key="t.id"
        :to="`/anastasai/t/${t.displayNumber}`"
        :class="[
          GRID,
          'items-center border-t border-line py-3 text-fg no-underline transition-fast [transition-property:background-color] hover:bg-elevated/50 hover:no-underline focus-visible:outline-offset-[-2px]',
        ]"
        @click="emit('open', t)"
      >
        <Mono class="pl-[17px]">#{{ t.displayNumber }}</Mono>
        <span class="flex min-w-0 flex-col gap-px">
          <span class="truncate text-body font-semibold">{{ customerName(t) }}</span>
          <Mono class="truncate text-[11px]">{{ t.customerEmail }}</Mono>
        </span>
        <span class="text-small">{{ caseText(t) }}</span>
        <span class="flex flex-col items-start gap-1">
          <StatusPill
            v-if="decisionPill(t).kind === 'pill'"
            :status="decisionPill(t).status"
            :dot="decisionPill(t).dot"
            >{{ decisionPill(t).label }}</StatusPill
          >
          <span
            v-else
            class="rounded-pill border border-line px-[9px] py-[2px] text-caption font-semibold text-fg-muted"
            >{{ decisionPill(t).label }}</span
          >
          <span v-if="t.decisionNote" class="text-[11px] text-fg-muted">{{ t.decisionNote }}</span>
        </span>
        <span class="text-caption leading-[1.45] text-fg-muted">{{ t.whatRan ?? '' }}</span>
        <Mono class="text-[11px]">{{ t.closedAt ? clockTime(t.closedAt) : '' }}</Mono>
      </NuxtLink>
    </template>
    <div v-if="items.length === 0" class="border-t border-line px-5 py-6 text-small text-fg-muted">
      {{ pending ? 'Loading…' : 'No closed tickets match these filters.' }}
    </div>
    <div ref="sentinel" class="border-t border-line px-5 py-3 text-small text-fg-muted">
      <template v-if="loadingMore">Loading older tickets…</template>
      <template v-else-if="hasMore">
        Older tickets load as you scroll · search covers everything
        <button
          type="button"
          class="ml-2 font-semibold text-fg hover:underline"
          @click="emit('loadMore')"
        >
          Load more
        </button>
      </template>
      <template v-else>That is every closed ticket here · search covers everything</template>
    </div>
  </Panel>
</template>
