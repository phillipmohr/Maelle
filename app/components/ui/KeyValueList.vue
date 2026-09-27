<script setup lang="ts">
/** KeyValueList. Inset surface with label/value rows; `mono` values use Geist Mono. */
import { cn } from '~/utils/cn'

export interface KeyValueItem {
  label: string
  value: string
  mono?: boolean
}

const props = defineProps<{
  items: KeyValueItem[]
  class?: string
}>()
</script>

<template>
  <dl
    :class="
      cn(
        'flex flex-col gap-2 rounded-md border border-line bg-inset px-4 py-[14px] font-sans text-small',
        props.class,
      )
    "
  >
    <div v-for="(it, i) in items" :key="i" class="flex justify-between gap-3">
      <dt class="text-fg-muted">{{ it.label }}</dt>
      <dd :class="cn('text-fg text-right', it.mono && 'font-mono')">{{ it.value }}</dd>
    </div>
  </dl>
</template>
