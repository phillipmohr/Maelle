<script setup lang="ts">
import { TabsTrigger, type TabsTriggerProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<TabsTriggerProps & { class?: string }>()
</script>

<template>
  <TabsTrigger
    :value="props.value"
    :disabled="props.disabled"
    :as-child="props.asChild"
    :as="props.as"
    :class="
      cn(
        'rounded-sm px-[11px] py-[5px] text-fg-muted outline-none transition-fast [transition-property:background-color,color]',
        'hover:text-fg data-[state=active]:bg-elevated data-[state=active]:text-fg disabled:opacity-45',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
