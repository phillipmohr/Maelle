<script setup lang="ts">
/**
 * The rail · list · detail · customer context layout. The list collapses in focus mode, the
 * context panel toggles. Slots: `list`, default (detail), `context`. Widths from the design.
 */
import { useShell } from '~/composables/useShell'

const props = withDefaults(defineProps<{ hasList?: boolean; hasContext?: boolean }>(), {
  hasList: true,
  hasContext: true,
})
const { focusMode, contextOpen } = useShell()
const slots = useSlots()
const showList = computed(() => props.hasList && !!slots.list && !focusMode.value)
const showContext = computed(() => props.hasContext && !!slots.context && contextOpen.value)
</script>

<template>
  <div class="flex min-w-0 flex-1">
    <aside
      v-if="showList"
      class="flex w-[var(--list-width)] shrink-0 flex-col overflow-hidden border-r border-line"
      aria-label="Ticket list"
    >
      <slot name="list" />
    </aside>
    <main class="relative flex min-w-0 flex-1 flex-col">
      <slot />
    </main>
    <aside
      v-if="showContext"
      class="w-[var(--context-width)] shrink-0 overflow-auto border-l border-line bg-page"
      aria-label="Customer context"
    >
      <slot name="context" />
    </aside>
  </div>
</template>
