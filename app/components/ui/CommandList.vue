<script setup lang="ts">
import { ListboxContent } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <ListboxContent :class="cn('max-h-[420px] overflow-y-auto p-2 outline-none', props.class)">
    <slot />
  </ListboxContent>
</template>
