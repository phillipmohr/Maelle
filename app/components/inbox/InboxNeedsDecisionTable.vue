<script setup lang="ts">
/**
 * "Needs decision": the one lit panel of the inbox. Ticket · Customer · Case · Status · Proposal · Age.
 * Rows are links, the selected one is focused (J/K move it, ⏎ opens it). High risk rows are tinted
 * ember, safety rows brick and pinned on top, researching rows show the live checklist in sand.
 * The parked rows (slot) sit at the bottom of the same panel, as in the design.
 */
import type { TicketListItem } from '#shared/api'
import {
  caseText,
  customerName,
  listTime,
  proposalText,
  researchChecklist,
  rowDot,
  rowPill,
  rowTint,
} from '~/composables/useInboxRows'

const props = defineProps<{
  rows: TicketListItem[]
  selected: number
  now: Date
}>()
const emit = defineEmits<{ select: [index: number]; open: [item: TicketListItem] }>()

const rowEls = ref<HTMLElement[]>([])

/** Move keyboard focus with the selection so focus is always visible. */
watch(
  () => props.selected,
  async (i) => {
    await nextTick()
    const el = rowEls.value[i]
    if (el && document.activeElement !== el) el.focus({ preventScroll: false })
  },
)

function setRowEl(el: unknown, i: number) {
  if (el) rowEls.value[i] = (el as { $el?: HTMLElement }).$el ?? (el as HTMLElement)
}

defineExpose({ focusSelected: () => rowEls.value[props.selected]?.focus() })

const GRID =
  'grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_190px_minmax(0,1.5fr)_72px] gap-[18px] px-5'
</script>

<template>
  <Panel elevation="focus" as="section" aria-label="Needs decision">
    <div class="flex items-center justify-between px-5 py-4">
      <Eyebrow tone="accent" as="h2">Needs decision</Eyebrow>
      <span class="flex items-center gap-[6px] text-caption text-fg-muted"
        >Open first <Kbd keys="⏎"
      /></span>
    </div>
    <div :class="[GRID, 'border-t border-line py-[10px] type-eyebrow text-fg-muted']" role="row">
      <span>Ticket</span><span>Customer</span><span>Case</span><span>Status</span
      ><span>Proposal</span><span>Age</span>
    </div>
    <NuxtLink
      v-for="(t, i) in rows"
      :key="t.id"
      :ref="(el) => setRowEl(el, i)"
      :to="`/anastasai/t/${t.displayNumber}`"
      :aria-current="i === selected ? 'true' : undefined"
      :class="[
        GRID,
        'items-center border-t border-line py-[14px] text-fg no-underline transition-fast [transition-property:background-color] hover:no-underline focus-visible:outline-offset-[-2px]',
        rowTint(t) === 'ember' && 'bg-ember/6',
        rowTint(t) === 'brick' && 'bg-brick/6',
        i === selected ? 'bg-elevated' : 'hover:bg-elevated/50',
      ]"
      @click="emit('open', t)"
      @focus="emit('select', i)"
    >
      <span class="flex items-center gap-[10px]">
        <RiskDot :kind="rowDot(t)" /><Mono>#{{ t.displayNumber }}</Mono>
      </span>
      <span class="flex min-w-0 flex-col gap-px">
        <span class="truncate text-body font-semibold">{{ customerName(t) }}</span>
        <Mono class="truncate text-[11px]">{{ t.customerEmail }}</Mono>
      </span>
      <span class="text-small">{{ caseText(t) }}</span>
      <span>
        <StatusPill :status="rowPill(t).status" :dot="rowPill(t).dot ?? true">{{
          rowPill(t).label
        }}</StatusPill>
      </span>
      <span class="flex min-w-0 flex-col gap-1">
        <span
          class="text-body leading-[1.45] [text-wrap:pretty]"
          :class="t.status === 'researching' || t.status === 'new' ? 'text-fg-muted' : 'text-fg'"
          >{{ proposalText(t) }}</span
        >
        <Mono v-if="t.runProgress" class="text-[11px]">{{ researchChecklist(t.runProgress) }}</Mono>
      </span>
      <Mono class="text-[11px]">{{ listTime(t, now) }}</Mono>
    </NuxtLink>
    <slot />
  </Panel>
</template>
