<script setup lang="ts">
/** Dialog content: elevated panel with the lamp glow over a near-black scrim. No icons; close is a text button. */
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<
    DialogContentProps & { class?: string; width?: number | string; hideClose?: boolean }
  >(),
  { width: 520, hideClose: false },
)
const emits = defineEmits<DialogContentEmits>()

const delegated = computed(() => {
  const { class: _c, width: _w, hideClose: _h, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out"
    />
    <DialogContent
      v-bind="forwarded"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-elevated p-6 shadow-lamp outline-none',
          'max-h-[85vh] w-[calc(100vw-32px)] overflow-auto data-[state=open]:animate-in data-[state=closed]:animate-out',
          props.class,
        )
      "
      :style="{ maxWidth: typeof width === 'number' ? `${width}px` : width }"
    >
      <slot />
      <DialogClose
        v-if="!hideClose"
        class="absolute right-4 top-4 rounded-sm px-[6px] py-px font-mono text-[11px] text-fg-muted hover:text-fg"
        aria-label="Close"
        >Esc</DialogClose
      >
    </DialogContent>
  </DialogPortal>
</template>
