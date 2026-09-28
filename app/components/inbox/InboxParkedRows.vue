<script setup lang="ts">
/**
 * Parked tickets at the bottom of the Needs decision panel: Waiting on customer (what we wait for,
 * since when) and Snoozed (returns when). Collapsed to one row per group; Show expands the tickets.
 */
import type { TicketListItem } from '#shared/api'
import {
  caseShort,
  customerName,
  listTime,
  returnLabel,
  type ParkedGroup,
} from '~/composables/useInboxRows'
import { shortDate } from '~/utils/format'

defineProps<{ groups: ParkedGroup[]; now: Date }>()
const emit = defineEmits<{ open: [item: TicketListItem]; unsnooze: [item: TicketListItem] }>()

const expanded = ref<Record<string, boolean>>({})
const GRID =
  'grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_190px_minmax(0,1.5fr)_72px] gap-[18px] px-5'

function detailLine(t: TicketListItem, now: Date): string {
  if (t.status === 'snoozed') return `Returns ${returnLabel(t.snoozedUntil, now)}`
  const what = t.waitingFor || 'Waiting for a reply'
  const queued = Math.max(t.actionCount - 1, 0)
  return `${what} since ${shortDate(t.lastMessageAt ?? t.updatedAt, now)}${
    queued > 0 ? ` · ${queued} queued` : ''
  }`
}
</script>

<template>
  <template v-for="g in groups" :key="g.key">
    <div
      :class="[GRID, 'items-center border-t border-line py-[11px] text-small text-fg-muted']"
      role="row"
    >
      <span class="flex items-center gap-[10px]">
        <RiskDot :kind="g.dot" /><Mono class="text-[11px]">{{ g.rows.length }}</Mono>
      </span>
      <span class="font-semibold text-fg">{{ g.name }}</span>
      <span class="col-span-3 truncate">{{ g.text }}</span>
      <button
        type="button"
        class="text-left text-caption text-fg-muted hover:text-fg"
        :aria-expanded="expanded[g.key] ? 'true' : 'false'"
        @click="expanded[g.key] = !expanded[g.key]"
      >
        {{ expanded[g.key] ? 'Hide' : 'Show' }}
      </button>
    </div>
    <template v-if="expanded[g.key]">
      <div
        v-for="t in g.rows"
        :key="t.id"
        :class="[GRID, 'items-center border-t border-line bg-page/40 py-[10px] text-small']"
      >
        <span class="flex items-center gap-[10px] pl-[17px]"
          ><Mono>#{{ t.displayNumber }}</Mono></span
        >
        <NuxtLink
          :to="`/anastasai/t/${t.displayNumber}`"
          class="truncate font-semibold text-fg no-underline hover:no-underline"
          @click="emit('open', t)"
          >{{ customerName(t) }}</NuxtLink
        >
        <span>{{ caseShort(t) }}</span>
        <span class="col-span-2 truncate text-fg-muted">{{ detailLine(t, now) }}</span>
        <span class="flex items-center justify-between gap-2">
          <Mono class="text-[11px]">{{ listTime(t, now) }}</Mono>
          <Button
            v-if="t.status === 'snoozed'"
            variant="ghost"
            size="sm"
            class="-my-1 px-2"
            @click="emit('unsnooze', t)"
            >Unsnooze</Button
          >
        </span>
      </div>
    </template>
  </template>
</template>
