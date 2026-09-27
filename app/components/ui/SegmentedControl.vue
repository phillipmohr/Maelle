<script setup lang="ts">
/**
 * Segmented control (radio group semantics, roving focus). Used for Always ask / Auto, the undo
 * window (5 / 10 / 15 min), All / You / Auto filters. Selected segment sits on the elevated surface.
 */
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { cn } from '~/utils/cn'

export interface SegmentOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SegmentOption[]
    mono?: boolean
    size?: 'md' | 'sm'
    ariaLabel?: string
    disabled?: boolean
    class?: string
  }>(),
  { mono: false, size: 'md', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <RadioGroupRoot
    :model-value="modelValue"
    :disabled="disabled"
    :aria-label="ariaLabel"
    orientation="horizontal"
    :class="
      cn(
        'inline-flex w-max gap-[2px] rounded-md border border-line p-[2px]',
        mono ? 'font-mono text-caption' : 'font-sans text-caption font-medium',
        props.class,
      )
    "
    @update:model-value="(v: unknown) => emit('update:modelValue', String(v ?? ''))"
  >
    <RadioGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      :disabled="o.disabled"
      :class="
        cn(
          'rounded-sm transition-fast [transition-property:background-color,color] disabled:opacity-45',
          size === 'sm' ? 'px-[10px] py-1' : 'px-[11px] py-[5px]',
          'text-fg-muted hover:text-fg data-[state=checked]:bg-elevated data-[state=checked]:text-fg',
        )
      "
    >
      {{ o.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
