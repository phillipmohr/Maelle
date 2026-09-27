<script setup lang="ts">
/** Wordmark. "Maelle" in Instrument Serif with a gilt final e. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    size?: number
    tagline?: boolean
    monogram?: boolean
    class?: string
  }>(),
  { size: 104, tagline: false, monogram: false },
)
</script>

<template>
  <span
    :class="cn(tagline ? 'inline-flex flex-col items-end gap-[10px]' : 'inline-flex', props.class)"
  >
    <span
      class="font-serif font-normal leading-[0.9] tracking-[-0.01em] text-fg"
      :style="{ fontSize: `${size}px` }"
      aria-label="Maelle"
      >{{ monogram ? 'M' : 'Maell' }}<span class="text-gilt">e</span></span
    >
    <span v-if="tagline" class="font-sans text-caption uppercase tracking-[0.22em] text-fg-muted"
      >The leader that serves</span
    >
  </span>
</template>
