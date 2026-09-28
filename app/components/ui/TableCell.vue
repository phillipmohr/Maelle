<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<{ class?: string; mono?: boolean }>(), { mono: false })
</script>

<template>
  <td
    :class="
      cn('px-5 py-[13px] text-small', mono && 'font-mono text-caption text-fg-muted', props.class)
    "
  >
    <slot />
  </td>
</template>
