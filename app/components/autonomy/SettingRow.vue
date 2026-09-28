<script setup lang="ts">
/** Label + caption on the left, the control on the right; hairline between rows (Safety net panel). */
defineProps<{ label: string; caption?: string }>()
</script>

<template>
  <div class="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
    <div class="flex min-w-0 flex-col gap-[2px]">
      <span class="text-body font-semibold">{{ label }}</span>
      <span v-if="caption" class="text-caption text-fg-muted">{{ caption }}</span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot />
    </div>
  </div>
</template>
