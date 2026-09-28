<script setup lang="ts">
import { TabsContent, type TabsContentProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<TabsContentProps & { class?: string }>()
</script>

<template>
  <TabsContent
    :value="props.value"
    :force-mount="props.forceMount"
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('mt-4 outline-none', props.class)"
  >
    <slot />
  </TabsContent>
</template>
