<script setup lang="ts">
/** Keyboard hint. `keys="G I"` renders a sequence, `keys="⌘K"` a single chord. */
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    keys: string | string[]
    tone?: 'default' | 'on-primary' | 'muted'
    class?: string
  }>(),
  { tone: 'default' },
)

const parts = computed(() =>
  Array.isArray(props.keys) ? props.keys : props.keys.split(' ').filter(Boolean),
)
</script>

<template>
  <span class="inline-flex items-center gap-1" aria-hidden="true">
    <kbd
      v-for="(k, i) in parts"
      :key="i"
      :class="
        cn(
          'inline-flex items-center justify-center rounded-sm font-mono text-[11px] leading-[1.4] font-medium',
          tone === 'on-primary'
            ? 'px-[6px] py-px bg-ink/12 text-on-primary font-semibold'
            : tone === 'muted'
              ? 'px-[5px] border border-line text-fg-muted'
              : 'px-[6px] py-px border border-line text-fg-muted',
          props.class,
        )
      "
      >{{ k }}</kbd
    >
  </span>
</template>
