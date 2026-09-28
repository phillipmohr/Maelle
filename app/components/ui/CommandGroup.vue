<script setup lang="ts">
import { ListboxGroup, ListboxGroupLabel } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<{ heading?: string; class?: string }>()
</script>

<template>
  <ListboxGroup :class="cn('py-1 empty:hidden [&:not(:has([role=option]))]:hidden', props.class)">
    <ListboxGroupLabel v-if="heading" class="px-2 pb-1 pt-2 type-eyebrow text-fg-muted">{{
      heading
    }}</ListboxGroupLabel>
    <slot />
  </ListboxGroup>
</template>
