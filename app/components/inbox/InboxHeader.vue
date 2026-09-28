<script setup lang="ts">
/** Inbox header: serif title, summary line, the ⌘K search box (opens the palette). */
import { useShortcuts } from '~/composables/useShortcuts'

defineProps<{ summary: string }>()
const { paletteOpen } = useShortcuts()
</script>

<template>
  <div class="flex items-end justify-between gap-8">
    <div class="flex flex-col gap-[10px]">
      <h1 class="type-display">Inbox</h1>
      <p class="text-body leading-[1.6] text-fg-muted">{{ summary }}</p>
    </div>
    <button
      type="button"
      class="flex w-[320px] items-center justify-between gap-6 rounded-md border border-line px-[10px] py-2 text-left text-small text-fg-muted transition-fast hover:border-line-strong hover:text-fg"
      @click="paletteOpen = true"
    >
      <span>Search all tickets</span><Kbd keys="⌘K" />
    </button>
  </div>
</template>
