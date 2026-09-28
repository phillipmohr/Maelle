<script setup lang="ts">
/**
 * StatusPill. Tinted fill (8%) and border (33%) of the status color, a 6px dot, 12px semibold.
 * draft = gilt, info = slate blue, success = sage, warning (high risk, irreversible) = ember,
 * error = brick, neutral = hairline outline.
 */
import { computed } from 'vue'
import { cn } from '~/utils/cn'

export type PillStatus = 'draft' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

const props = withDefaults(
  defineProps<{
    status?: PillStatus
    dot?: boolean
    class?: string
  }>(),
  { status: 'draft', dot: true },
)

const LABELS: Record<PillStatus, string> = {
  draft: 'Needs decision',
  info: 'In progress',
  success: 'Done',
  warning: 'High risk',
  error: 'Failed',
  neutral: 'Neutral',
}

const tint = computed(
  () =>
    ({
      draft: 'tint-gilt',
      info: 'tint-slate-blue',
      success: 'tint-sage',
      warning: 'tint-ember',
      error: 'tint-brick',
      neutral: 'border-line text-fg-muted bg-transparent',
    })[props.status],
)
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center gap-[6px] rounded-pill border pl-2 pr-[9px] py-[3px] font-sans text-caption font-semibold tracking-[0.01em] whitespace-nowrap',
        tint,
        props.class,
      )
    "
  >
    <span v-if="dot" class="size-[6px] rounded-pill bg-current" aria-hidden="true" />
    <slot>{{ LABELS[status] }}</slot>
  </span>
</template>
