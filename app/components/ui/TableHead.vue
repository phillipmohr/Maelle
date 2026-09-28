<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <th
    scope="col"
    :class="cn('px-5 py-[10px] type-eyebrow text-fg-muted font-semibold', props.class)"
  >
    <slot />
  </th>
</template>
