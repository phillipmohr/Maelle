<script setup lang="ts">
/**
 * Chip: filter pill (All / Risk / Billing), meta chip (mono, elevated: "Due Oct 7", "Stage 1 of 2"),
 * tag chip (hairline: "Long-term"). Interactive chips are buttons with `active`.
 */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    variant?: 'filter' | 'meta' | 'tag'
    active?: boolean
    interactive?: boolean
    class?: string
  }>(),
  { variant: 'filter', active: false, interactive: false },
)

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    :aria-pressed="interactive ? active : undefined"
    :class="
      cn(
        'inline-flex items-center whitespace-nowrap',
        variant === 'filter' &&
          cn(
            'rounded-pill px-[9px] py-[3px] font-sans text-caption border',
            active ? 'border-transparent bg-elevated text-fg' : 'border-line text-fg-muted',
            interactive &&
              'transition-fast [transition-property:color,border-color] hover:text-fg hover:border-line-strong',
          ),
        variant === 'meta' &&
          'rounded-sm bg-elevated px-2 py-[3px] font-mono text-[11px] text-fg-muted',
        variant === 'tag' &&
          'rounded-sm border border-line px-2 py-[2px] font-sans text-caption text-fg',
        props.class,
      )
    "
    @click="interactive && emit('click')"
  >
    <slot />
  </component>
</template>
