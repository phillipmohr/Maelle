<script setup lang="ts">
/**
 * Panel. base = umber-900, elevated = umber-850, focus = elevated + the lamp glow.
 * The proposal is the only `focus` panel on a screen.
 */
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    elevation?: 'base' | 'elevated' | 'focus'
    padding?: number | string
    as?: string
    class?: string
  }>(),
  { elevation: 'base', as: 'div' },
)

const style = computed(() =>
  props.padding === undefined
    ? undefined
    : { padding: typeof props.padding === 'number' ? `${props.padding}px` : props.padding },
)
</script>

<template>
  <component
    :is="as"
    :class="
      cn(
        'overflow-hidden rounded-lg border border-line',
        elevation === 'base' ? 'bg-base' : 'bg-elevated',
        elevation === 'focus' && 'shadow-lamp lamp-bg',
        props.class,
      )
    "
    :style="style"
  >
    <slot />
  </component>
</template>
