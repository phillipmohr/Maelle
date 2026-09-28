<script setup lang="ts">
/**
 * RiskDot. 7px. high = ember solid, safety = ember solid with ring, researching = sand dashed ring,
 * waiting = slate blue solid, snoozed = sand ring, failed = brick solid, none = faint sand.
 */
import { computed } from 'vue'
import { cn } from '~/utils/cn'

export type RiskDotKind =
  'none' | 'high' | 'safety' | 'research' | 'wait' | 'snoozed' | 'failed' | 'auto' | 'done'

const props = withDefaults(defineProps<{ kind?: RiskDotKind; class?: string }>(), { kind: 'none' })

const style = computed(
  () =>
    (
      ({
        none: 'bg-sand/50 border-transparent',
        high: 'bg-ember border-ember',
        safety: 'bg-ember border-ember ring-[3px] ring-ember/25',
        research: 'bg-transparent border-sand border-dashed',
        wait: 'bg-slate-blue border-slate-blue',
        snoozed: 'bg-transparent border-sand',
        failed: 'bg-brick border-brick',
        auto: 'bg-gilt border-gilt rounded-none rotate-45 scale-90',
        done: 'bg-sage border-sage',
      }) as Record<RiskDotKind, string>
    )[props.kind],
)
</script>

<template>
  <span
    :class="
      cn(
        'inline-block size-[7px] shrink-0 rounded-pill border-[1.5px] box-border',
        style,
        props.class,
      )
    "
    aria-hidden="true"
  />
</template>
