<script setup lang="ts">
/** Eyebrow. 11px semibold uppercase with 0.14em tracking; sand by default, gilt for accent. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    tone?: 'secondary' | 'accent' | 'ember' | 'brick'
    as?: string
    class?: string
  }>(),
  { tone: 'secondary', as: 'span' },
)
</script>

<template>
  <component
    :is="as"
    :class="
      cn(
        'type-eyebrow',
        tone === 'accent'
          ? 'text-fg-accent'
          : tone === 'ember'
            ? 'text-ember'
            : tone === 'brick'
              ? 'text-brick'
              : 'text-fg-muted',
        props.class,
      )
    "
  >
    <slot />
  </component>
</template>
