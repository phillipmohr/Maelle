<script setup lang="ts">
/** Risk banner in ember (high) or brick (safety): eyebrow + one-sentence reason. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    level?: 'high' | 'safety' | 'info'
    eyebrow: string
    class?: string
  }>(),
  { level: 'high' },
)
</script>

<template>
  <div
    role="note"
    :class="
      cn(
        'flex flex-col gap-[6px] rounded-lg border px-[18px] py-[14px]',
        level === 'high' ? 'tint-ember' : level === 'safety' ? 'tint-brick' : 'tint-slate-blue',
        props.class,
      )
    "
  >
    <span class="type-eyebrow">{{ eyebrow }}</span>
    <span class="text-body text-fg [text-wrap:pretty]"><slot /></span>
  </div>
</template>
