<script setup lang="ts">
/**
 * Toaster (vue-sonner) restyled: elevated panel with the lamp glow, sage dot for success.
 * Use `import { toast } from 'vue-sonner'` or the `useToast()` composable.
 */
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'
</script>

<template>
  <Toaster
    position="bottom-right"
    :duration="6000"
    :visible-toasts="3"
    :offset="{ bottom: 88, right: 24 }"
    :toast-options="{
      unstyled: true,
      classes: {
        toast:
          'maelle-toast flex w-[340px] flex-col gap-[10px] rounded-lg border border-line bg-elevated px-4 py-[14px] font-sans text-fg shadow-lamp',
        title: 'flex items-center gap-2 text-small font-semibold',
        description: 'text-caption text-fg-muted whitespace-pre-line',
        actionButton:
          'rounded-sm border border-line px-2 py-1 text-caption font-semibold text-fg hover:border-line-strong',
        cancelButton: 'rounded-sm px-2 py-1 text-caption text-fg-muted hover:text-fg',
        closeButton: 'hidden',
      },
    }"
  />
</template>

<style>
/* Success toasts carry the sage dot the design shows before the title. */
.maelle-toast[data-type='success'] [data-title]::before,
.maelle-toast[data-type='default'] [data-title]::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--sage-400);
  flex: none;
}
.maelle-toast[data-type='error'] [data-title]::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--brick-400);
  flex: none;
}
.maelle-toast[data-type='warning'] [data-title]::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ember-400);
  flex: none;
}
.maelle-toast [data-icon] {
  display: none;
}
</style>
