<script setup lang="ts">
/** Tabs list styled as the design's segmented control. */
import { TabsList, type TabsListProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<TabsListProps & { class?: string }>()
</script>

<template>
  <TabsList
    :as-child="props.asChild"
    :as="props.as"
    :loop="props.loop"
    :class="
      cn(
        'inline-flex w-max gap-[2px] rounded-md border border-line p-[2px] font-sans text-caption font-medium',
        props.class,
      )
    "
  >
    <slot />
  </TabsList>
</template>
