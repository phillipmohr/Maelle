<script setup lang="ts">
import { ListboxItem } from 'reka-ui'
import { computed, inject, onBeforeUnmount, watchEffect } from 'vue'
import { COMMAND_KEY } from '~/composables/commandContext'
import { cn } from '~/utils/cn'

const props = defineProps<{
  value: string
  /** Text used for filtering; defaults to the value. */
  text?: string
  keys?: string
  disabled?: boolean
  class?: string
}>()

const ctx = inject(COMMAND_KEY)!
const searchText = computed(() => props.text ?? props.value)
watchEffect(() => ctx.registerItem(props.value, searchText.value))
onBeforeUnmount(() => ctx.unregisterItem(props.value))
const visible = computed(() => ctx.matches(searchText.value))
</script>

<template>
  <ListboxItem
    v-if="visible"
    :value="value"
    :disabled="disabled"
    :class="
      cn(
        'flex cursor-default select-none items-center justify-between gap-4 rounded-sm px-[10px] py-[8px] font-sans text-small text-fg outline-none',
        'data-[highlighted]:bg-base data-[disabled]:opacity-45',
        props.class,
      )
    "
  >
    <span class="flex min-w-0 items-center gap-2 truncate"><slot /></span>
    <Kbd v-if="keys" :keys="keys" tone="muted" />
  </ListboxItem>
</template>
