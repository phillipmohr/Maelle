<script setup lang="ts">
/**
 * The 3-dot menu: a quiet "···" trigger (CSS dots, no icon set) that opens a DropdownMenu with the
 * slot's items. For secondary commands next to a surface (regenerate a reply, bulk actions).
 */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    /** Accessible name of the trigger, e.g. "Reply options". */
    label: string
    disabled?: boolean
    align?: 'start' | 'center' | 'end'
    class?: string
  }>(),
  { disabled: false, align: 'end' },
)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      :disabled="disabled"
      :aria-label="label"
      :title="label"
      :class="
        cn(
          'inline-flex h-6 w-7 items-center justify-center gap-[3px] rounded-sm text-fg-muted outline-none transition-fast hover:text-fg focus-visible:outline-offset-[-2px] disabled:cursor-default disabled:opacity-45 data-[state=open]:text-fg',
          props.class,
        )
      "
    >
      <span v-for="i in 3" :key="i" class="size-[3px] rounded-pill bg-current" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent :align="align" class="w-[320px]">
      <slot />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
