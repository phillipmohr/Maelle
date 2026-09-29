<script setup lang="ts">
/**
 * Jump bar for the ticket detail: one pill per section (Proposal, Message, Actions, Reply, …).
 * Sections are discovered from the scroll container (see useSectionNav), so a new
 * `section[aria-label]` in the detail appears here on its own. Sticky at the top of the
 * container; scrolls sideways when the pills outgrow the column.
 */
import type { Ref } from 'vue'
import { useSectionNav } from '~/composables/useSectionNav'

const props = defineProps<{ container: HTMLElement | null }>()

const bar = ref<HTMLElement | null>(null)
const container = toRef(props, 'container') as Ref<HTMLElement | null>
const { sections, activeId, scrollTo } = useSectionNav(container, {
  offset: () => (bar.value?.offsetHeight ?? 0) + 12,
})

// Keep the active pill visible when the bar overflows, without moving the page vertically.
watch(activeId, (id) => {
  const root = bar.value
  const pill = id ? root?.querySelector<HTMLElement>(`[data-target="${id}"]`) : null
  if (!root || !pill) return
  const left = pill.offsetLeft
  const right = left + pill.offsetWidth
  if (left < root.scrollLeft) root.scrollTo({ left: left - 16, behavior: 'smooth' })
  else if (right > root.scrollLeft + root.clientWidth)
    root.scrollTo({ left: right - root.clientWidth + 16, behavior: 'smooth' })
})
</script>

<template>
  <nav
    v-show="sections.length > 1"
    ref="bar"
    aria-label="Sections"
    class="sticky top-0 z-10 -mx-8 flex gap-[6px] overflow-x-auto overscroll-x-contain whitespace-nowrap border-b border-line bg-page px-8 py-[10px]"
  >
    <button
      v-for="s in sections"
      :key="s.id"
      type="button"
      :data-target="s.id"
      :aria-current="activeId === s.id ? 'location' : undefined"
      :class="[
        'shrink-0 rounded-pill border px-[10px] py-[3px] font-sans text-caption transition-fast [transition-property:color,border-color,background-color] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-strong',
        activeId === s.id
          ? 'border-transparent bg-elevated text-fg'
          : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
      ]"
      @click="scrollTo(s.id)"
    >
      {{ s.label }}
    </button>
  </nav>
</template>
