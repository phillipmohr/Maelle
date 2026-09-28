<script setup lang="ts">
/** The lock drawn with two CSS shapes (no icon set). Ember by default, for irreversible actions. */
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<{ size?: 'sm' | 'md'; color?: string; class?: string }>(), {
  size: 'sm',
  color: 'var(--ember-400)',
})
</script>

<template>
  <span :class="cn('inline-flex flex-col items-center', props.class)" aria-hidden="true">
    <span
      :class="
        cn(
          'rounded-t-[3px] border-[1.5px] border-b-0',
          size === 'sm' ? 'h-1 w-[5px]' : 'h-[5px] w-[6px]',
        )
      "
      :style="{ borderColor: color }"
    />
    <span
      :class="cn('rounded-[1.5px]', size === 'sm' ? 'h-[6px] w-[9px]' : 'h-[7px] w-[11px]')"
      :style="{ background: color }"
    />
  </span>
</template>
