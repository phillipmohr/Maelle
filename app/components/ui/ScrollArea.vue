<script setup lang="ts">
/** ScrollArea (reka-ui) with a thin umber thumb. */
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  type ScrollAreaRootProps,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from 'reka-ui'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<ScrollAreaRootProps & { class?: string; viewportClass?: string }>(),
  { type: 'hover' },
)
</script>

<template>
  <ScrollAreaRoot
    :type="props.type"
    :dir="props.dir"
    :scroll-hide-delay="props.scrollHideDelay"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <ScrollAreaViewport :class="cn('size-full rounded-[inherit]', viewportClass)">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      orientation="vertical"
      class="flex w-2 touch-none select-none p-px transition-colors"
    >
      <ScrollAreaThumb class="relative flex-1 rounded-pill bg-umber-700" />
    </ScrollAreaScrollbar>
    <ScrollAreaScrollbar
      orientation="horizontal"
      class="flex h-2 touch-none select-none flex-col p-px transition-colors"
    >
      <ScrollAreaThumb class="relative flex-1 rounded-pill bg-umber-700" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
