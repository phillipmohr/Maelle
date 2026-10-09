<script setup lang="ts">
/**
 * Inbox (screens 3a and 3b). Owner: IRDR-458. Inbox and History are one page: the lit
 * "Needs decision" table on top (or the cleared state), parked and auto-handled rows, then the
 * closed history with filters, day groups and infinite scroll. ⏎ opens the selected row, J/K move.
 */
import type { TicketListItem } from '#shared/api'
import { useCommands } from '~/composables/useCommands'
import { closedQuery, useInboxFilters } from '~/composables/useInboxFilters'
import {
  autoRows,
  inboxSummary,
  needsDecisionRows,
  parkedGroups,
  regenerableDrafts,
} from '~/composables/useInboxRows'
import { useRealtime } from '~/composables/useRealtime'
import { useShortcuts, useShortcutScope } from '~/composables/useShortcuts'
import { useTicketClock } from '~/composables/useTicketClock'
import {
  regenerateDrafts,
  useClosedTickets,
  useTicketActions,
  useTicketList,
} from '~/composables/useTickets'
import { useToast } from '~/composables/useToast'

useHead({ title: 'Inbox' })
useShortcutScope('inbox')

const route = useRoute()
const { nowDate } = useTicketClock()
const { data: list, refresh: refreshList } = useTicketList()

// Dev only: `?preview=cleared` renders screen 3b with the seed data.
const previewCleared = computed(() => import.meta.dev && route.query.preview === 'cleared')
const items = computed(() => {
  const all = list.value?.items ?? []
  return previewCleared.value ? all.filter((t) => t.status === 'closed') : all
})
const rows = computed(() => needsDecisionRows(items.value))
const parked = computed(() => parkedGroups(items.value, nowDate.value))
const auto = computed(() => autoRows(items.value))
const summary = computed(() => (list.value ? inboxSummary(list.value.counts, items.value) : ''))

const selected = ref(0)
watch(rows, (r) => {
  if (selected.value > r.length - 1) selected.value = Math.max(0, r.length - 1)
})

const { closed: closedFilters } = useInboxFilters()
const closedParams = computed(() => closedQuery(closedFilters.value, nowDate.value))
const closed = await useClosedTickets(closedParams)
const closedFiltersOpen = ref(false)

useRealtime()

function open(t: TicketListItem | undefined) {
  if (t) navigateTo(`/anastasai/t/${t.displayNumber}`)
}

const toast = useToast()
async function unsnooze(t: TicketListItem) {
  try {
    await useTicketActions(t.id).unsnooze()
    toast.info(`#${t.displayNumber} is back in the inbox`)
    await refreshList()
  } catch {
    toast.info('Not available yet', 'Unsnooze is still being built.')
  }
}
async function undo(t: TicketListItem) {
  try {
    const res = await useTicketActions(t.id).undo()
    toast.info(
      res.cancelled.length > 0 ? `Undone · ${res.cancelled.length} cancelled` : 'Nothing to undo',
    )
    await refreshList()
  } catch {
    toast.info('Not available yet', 'Undo is still being built.')
  }
}

// 3-dot menu: draft every unsent reply again (templates, protocol or settings changed).
const draftCount = computed(() => regenerableDrafts(items.value).length)
const regenerateOpen = ref(false)
const regenerating = ref(false)
async function regenerateAll() {
  if (regenerating.value) return
  regenerating.value = true
  try {
    const res = await regenerateDrafts()
    regenerateOpen.value = false
    toast.info(
      res.count > 0
        ? `Regenerating ${res.count} ${res.count === 1 ? 'draft' : 'drafts'}`
        : 'Nothing to regenerate',
      res.count > 0
        ? 'The tickets show as researching until the new drafts are ready.'
        : 'Every unsent draft is already being drafted again.',
    )
    await refreshList()
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    toast.error(
      'Could not regenerate the drafts',
      status === 503 ? 'Needs the database (SUPABASE_DB_URL).' : 'Nothing was queued · try again.',
    )
  } finally {
    regenerating.value = false
  }
}

const table = ref<{ focusSelected: () => void } | null>(null)
const { register } = useShortcuts()
register([
  {
    id: 'inbox.next',
    keys: 'j',
    label: 'Next ticket',
    group: 'Inbox',
    scope: 'inbox',
    when: () => !closedFiltersOpen.value && !regenerateOpen.value,
    handler: () => {
      selected.value = Math.min(selected.value + 1, rows.value.length - 1)
      table.value?.focusSelected()
    },
  },
  {
    id: 'inbox.prev',
    keys: 'k',
    label: 'Previous ticket',
    group: 'Inbox',
    scope: 'inbox',
    when: () => !closedFiltersOpen.value && !regenerateOpen.value,
    handler: () => {
      selected.value = Math.max(selected.value - 1, 0)
      table.value?.focusSelected()
    },
  },
  {
    id: 'inbox.open',
    keys: 'enter',
    label: 'Open the selected ticket',
    group: 'Inbox',
    scope: 'inbox',
    when: () => !closedFiltersOpen.value && !regenerateOpen.value,
    handler: () => open(rows.value[selected.value]),
  },
  {
    id: 'inbox.filters',
    keys: 'f',
    label: 'Filter closed tickets',
    group: 'Inbox',
    scope: 'inbox',
    when: () => !regenerateOpen.value,
    handler: () => (closedFiltersOpen.value = !closedFiltersOpen.value),
  },
])

useCommands().register([
  {
    id: 'inbox.regenerateDrafts',
    label: 'Regenerate all unsent drafts',
    group: 'Inbox',
    when: () => draftCount.value > 0,
    run: () => (regenerateOpen.value = true),
  },
  {
    id: 'inbox.openFirst',
    label: 'Open the first ticket that needs a decision',
    group: 'Inbox',
    keys: 'enter',
    when: () => rows.value.length > 0,
    run: () => open(rows.value[0]),
  },
])

function scrollToHash() {
  if (route.hash === '#closed') {
    nextTick(() => document.getElementById('closed')?.scrollIntoView({ block: 'start' }))
  }
}
onMounted(scrollToHash)
watch(() => route.hash, scrollToHash)
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <InboxHeader
      :summary="summary"
      :draft-count="draftCount"
      @regenerate-all="regenerateOpen = true"
    />
    <InboxRegenerateDialog
      v-model:open="regenerateOpen"
      :count="draftCount"
      :busy="regenerating"
      @confirm="regenerateAll"
    />

    <InboxNeedsDecisionTable
      v-if="rows.length > 0"
      ref="table"
      :rows="rows"
      :selected="selected"
      :now="nowDate"
      @select="(i) => (selected = i)"
      @open="open"
    >
      <InboxParkedRows :groups="parked" :now="nowDate" @open="open" @unsnooze="unsnooze" />
    </InboxNeedsDecisionTable>
    <InboxClearedState v-else :groups="parked" />

    <InboxAutoHandledRows
      v-if="auto.length > 0"
      :rows="auto"
      :now="nowDate"
      @undo="undo"
      @open="open"
    />

    <InboxClosedTable
      v-model:filters="closedFilters"
      v-model:filters-open="closedFiltersOpen"
      :items="closed.items.value"
      :case-counts="closed.caseCounts.value"
      :now="nowDate"
      :has-more="closed.hasMore.value"
      :loading-more="closed.loadingMore.value"
      :pending="closed.pending.value"
      @load-more="closed.loadMore"
      @open="open"
    />
  </div>
</template>
