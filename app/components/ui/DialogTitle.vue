<script setup lang="ts">
import { DialogTitle, type DialogTitleProps } from 'reka-ui'
import { cn } from '~/utils/cn'

const props = defineProps<DialogTitleProps & { class?: string }>()
</script>

<template>
  <DialogTitle
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('font-serif text-heading text-fg [text-wrap:pretty]', props.class)"
  >
    <slot />
  </DialogTitle>
</template>
