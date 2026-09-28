<script setup lang="ts">
/** Command inside a top-anchored Dialog (the ⌘K palette). */
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  VisuallyHidden,
} from 'reka-ui'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; select: [value: string] }>()
</script>

<template>
  <DialogRoot :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out"
      />
      <DialogContent
        class="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out"
      >
        <VisuallyHidden>
          <DialogTitle>{{ title ?? 'Command palette' }}</DialogTitle>
        </VisuallyHidden>
        <Command @select="(v) => emit('select', v)">
          <slot />
        </Command>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
