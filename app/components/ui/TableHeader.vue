<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <thead :class="cn('[&_tr]:border-b [&_tr]:border-line', props.class)">
    <slot />
  </thead>
</template>
