<script setup lang="ts">
import {
  PopoverContent,
  type PopoverContentEmits,
  type PopoverContentProps,
  PopoverPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<PopoverContentProps & { class?: string }>(), {
  align: 'start',
  sideOffset: 6,
})
const emits = defineEmits<PopoverContentEmits>()
const delegated = computed(() => {
  const { class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      v-bind="forwarded"
      :class="
        cn(
          'z-50 min-w-[220px] rounded-md border border-line bg-elevated p-3 shadow-lamp outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
          props.class,
        )
      "
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
