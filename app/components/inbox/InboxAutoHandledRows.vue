<script setup lang="ts">
/**
 * "Handled automatically": tickets inside the Auto undo window, each with an Undo button.
 * Rendered only when there are rows (the seed has none).
 */
import type { TicketListItem } from '#shared/api'
import { caseShort, customerName } from '~/composables/useInboxRows'
import { clockTime } from '~/utils/format'

defineProps<{ rows: TicketListItem[]; now: Date }>()
const emit = defineEmits<{ undo: [item: TicketListItem]; open: [item: TicketListItem] }>()
</script>

<template>
  <section class="flex flex-col gap-[10px]" aria-label="Handled automatically">
    <div class="flex items-baseline justify-between">
      <Eyebrow as="h2">Handled automatically</Eyebrow>
      <span class="text-caption text-fg-muted">Undo while the window is open</span>
    </div>
    <Panel class="divide-hairline">
      <div
        v-for="t in rows"
        :key="t.id"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[14px] gap-y-[3px] px-[18px] py-[13px]"
      >
        <NuxtLink
          :to="`/anastasai/t/${t.displayNumber}`"
          class="truncate text-body font-semibold text-fg no-underline hover:no-underline"
          @click="emit('open', t)"
          >{{ customerName(t) }}</NuxtLink
        >
        <Mono class="text-[11px]">{{ clockTime(t.updatedAt) }}</Mono>
        <span class="truncate text-caption text-fg-muted"
          >{{ caseShort(t) }} · {{ t.proposalLine ?? t.whatRan ?? '' }}</span
        >
        <span class="flex items-center justify-end gap-3 text-caption text-fg-muted">
          <span class="flex items-center gap-2"
            ><RiskDot kind="auto" />Auto · undo window open</span
          >
          <Button variant="secondary" size="sm" @click="emit('undo', t)">Undo</Button>
        </span>
      </div>
    </Panel>
  </section>
</template>
