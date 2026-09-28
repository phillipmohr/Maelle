<script setup lang="ts">
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    class?: string
    tint?: 'none' | 'ember' | 'brick' | 'slate-blue'
    interactive?: boolean
    selected?: boolean
  }>(),
  {
    tint: 'none',
    interactive: false,
    selected: false,
  },
)
</script>

<template>
  <tr
    :class="
      cn(
        'align-middle',
        tint === 'ember' && 'bg-ember/6',
        tint === 'brick' && 'bg-brick/6',
        tint === 'slate-blue' && 'bg-slate-blue/6',
        interactive &&
          'cursor-pointer transition-fast [transition-property:background-color] hover:bg-elevated/50 focus-within:bg-elevated/50',
        selected && 'bg-elevated',
        props.class,
      )
    "
  >
    <slot />
  </tr>
</template>
