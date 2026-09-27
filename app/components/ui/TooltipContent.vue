<script setup lang="ts">
import {
  TooltipContent,
  type TooltipContentEmits,
  type TooltipContentProps,
  TooltipPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<TooltipContentProps & { class?: string }>(), {
  sideOffset: 6,
})
const emits = defineEmits<TooltipContentEmits>()
const delegated = computed(() => {
  const { class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="forwarded"
      :class="
        cn(
          'z-50 max-w-[280px] rounded-sm border border-line bg-elevated px-2 py-1 font-sans text-caption text-fg shadow-lamp data-[state=delayed-open]:animate-in',
          props.class,
        )
      "
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
