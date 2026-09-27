<script setup lang="ts">
import {
  DropdownMenuItem,
  type DropdownMenuItemEmits,
  type DropdownMenuItemProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = defineProps<
  DropdownMenuItemProps & { class?: string; kbd?: string; tone?: 'default' | 'danger' }
>()
const emits = defineEmits<DropdownMenuItemEmits>()
const delegated = computed(() => {
  const { class: _c, kbd: _k, tone: _t, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <DropdownMenuItem
    v-bind="forwarded"
    :class="
      cn(
        'flex cursor-default select-none items-center justify-between gap-4 rounded-sm px-[10px] py-[7px] font-sans text-small outline-none',
        tone === 'danger' ? 'text-brick' : 'text-fg',
        'data-[highlighted]:bg-base data-[disabled]:opacity-45',
        props.class,
      )
    "
  >
    <span class="flex items-center gap-2"><slot /></span>
    <Kbd v-if="kbd" :keys="kbd" tone="muted" />
  </DropdownMenuItem>
</template>
