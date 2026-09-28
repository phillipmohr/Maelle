<script setup lang="ts">
/** PanelHeader. Title as eyebrow (uppercase caption) or as a 20px serif heading, optional mono meta. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    title: string
    meta?: string | null
    eyebrow?: boolean
    class?: string
  }>(),
  { eyebrow: false, meta: null },
)
</script>

<template>
  <div
    :class="
      cn('flex items-center justify-between gap-3 border-b border-line px-[18px] py-4', props.class)
    "
  >
    <Eyebrow v-if="eyebrow" as="h2">{{ title }}</Eyebrow>
    <h2 v-else class="font-serif text-h3 text-fg">{{ title }}</h2>
    <span
      v-if="meta != null"
      :class="cn('font-mono text-fg-muted', eyebrow ? 'text-[11px]' : 'text-caption')"
      >{{ meta }}</span
    >
    <slot />
  </div>
</template>
