<script setup lang="ts">
import {
  DropdownMenuContent,
  type DropdownMenuContentEmits,
  type DropdownMenuContentProps,
  DropdownMenuPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<DropdownMenuContentProps & { class?: string }>(), {
  align: 'start',
  sideOffset: 6,
})
const emits = defineEmits<DropdownMenuContentEmits>()
const delegated = computed(() => {
  const { class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      v-bind="forwarded"
      :class="
        cn(
          'z-50 min-w-[200px] overflow-hidden rounded-md border border-line bg-elevated p-1 shadow-lamp outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
          props.class,
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
