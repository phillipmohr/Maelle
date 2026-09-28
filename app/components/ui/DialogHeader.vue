<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('flex flex-col gap-2 pr-10', props.class)">
    <slot />
  </div>
</template>
