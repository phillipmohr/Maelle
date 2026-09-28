<script setup lang="ts">
/** Tooltip root. Wrap the app once in TooltipProvider (done in app.vue). */
import {
  TooltipRoot,
  type TooltipRootEmits,
  type TooltipRootProps,
  useForwardPropsEmits,
} from 'reka-ui'

const props = withDefaults(defineProps<TooltipRootProps>(), { delayDuration: 250 })
const emits = defineEmits<TooltipRootEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <TooltipRoot v-bind="forwarded">
    <slot />
  </TooltipRoot>
</template>
