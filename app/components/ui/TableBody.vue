<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <tbody :class="cn('[&_tr+tr]:border-t [&_tr+tr]:border-line', props.class)">
    <slot />
  </tbody>
</template>
