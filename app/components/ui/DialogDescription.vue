<script setup lang="ts">
import { DialogDescription, type DialogDescriptionProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<DialogDescriptionProps & { class?: string }>()
</script>

<template>
  <DialogDescription
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('text-body text-fg-muted [text-wrap:pretty]', props.class)"
  >
    <slot />
  </DialogDescription>
</template>
