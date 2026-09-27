<script setup lang="ts">
import { DropdownMenuLabel, type DropdownMenuLabelProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<DropdownMenuLabelProps & { class?: string }>()
</script>

<template>
  <DropdownMenuLabel
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('px-[10px] pb-1 pt-2 type-eyebrow text-fg-muted', props.class)"
  >
    <slot />
  </DropdownMenuLabel>
</template>
