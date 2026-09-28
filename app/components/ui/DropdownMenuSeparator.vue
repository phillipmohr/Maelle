<script setup lang="ts">
import { DropdownMenuSeparator, type DropdownMenuSeparatorProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<DropdownMenuSeparatorProps & { class?: string }>()
</script>

<template>
  <DropdownMenuSeparator
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('-mx-1 my-1 h-px bg-line', props.class)"
  />
</template>
