<script setup lang="ts">
/** Provenance line: gilt diamond + "Prepared by AnastasAI from …". */
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('flex items-center gap-[10px]', props.class)">
    <span class="size-2 shrink-0 rotate-45 bg-gilt" aria-hidden="true" />
    <span class="font-sans text-caption text-fg-muted"><slot /></span>
  </div>
</template>
