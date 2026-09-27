<script setup lang="ts">
/** Mono. Geist Mono for ids, params and evidence. `chip` gives it an elevated pill background. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    chip?: boolean
    size?: number
    tone?: 'muted' | 'primary'
    as?: string
    class?: string
  }>(),
  { chip: false, tone: 'muted', as: 'span' },
)
</script>

<template>
  <component
    :is="as"
    :class="
      cn(
        'font-mono',
        chip
          ? 'rounded-xs bg-elevated px-[5px] py-px text-fg'
          : tone === 'primary'
            ? 'text-fg'
            : 'text-fg-muted',
        props.class,
      )
    "
    :style="{ fontSize: `${size ?? (chip ? 13 : 12)}px` }"
  >
    <slot />
  </component>
</template>
