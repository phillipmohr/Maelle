<script setup lang="ts">
/** Table: eyebrow header row, hairline dividers. Use with TableHeader/TableBody/TableRow/TableHead/TableCell. */
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div class="w-full overflow-auto">
    <table
      :class="cn('w-full border-collapse text-left font-sans text-small text-fg', props.class)"
    >
      <slot />
    </table>
  </div>
</template>
