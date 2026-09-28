<script setup lang="ts">
/**
 * Checkbox (reka-ui, restyled). 16px, 4px radius, ✓ drawn as text. `tone` mirrors the action states
 * of the design: default (ivory when checked), success (sage, Done), error (brick, ×), queued or
 * held (dashed sand ring, empty). Display-only usage: pass `readonly`.
 */
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean | 'indeterminate'
    disabled?: boolean
    readonly?: boolean
    tone?: 'default' | 'success' | 'error' | 'queued' | 'held'
    id?: string
    name?: string
    class?: string
  }>(),
  { modelValue: false, disabled: false, readonly: false, tone: 'default' },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean | 'indeterminate'] }>()

const checked = computed({
  get: () => props.modelValue,
  set: (v) => {
    if (!props.readonly) emit('update:modelValue', v)
  },
})

const box = computed(() => {
  switch (props.tone) {
    case 'success':
      return 'border-sage bg-sage text-ink'
    case 'error':
      return 'border-brick bg-transparent text-brick'
    case 'queued':
    case 'held':
      return 'border-dashed border-sand bg-transparent text-sand'
    default:
      return props.modelValue
        ? 'border-ivory bg-ivory text-ink'
        : 'border-sand/70 bg-transparent hover:border-sand'
  }
})

const mark = computed(() =>
  props.tone === 'error' ? '×' : props.tone === 'queued' || props.tone === 'held' ? '' : '✓',
)
</script>

<template>
  <CheckboxRoot
    :id="id"
    v-model="checked"
    :name="name"
    :disabled="disabled"
    :class="
      cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border-[1.5px] box-border text-[11px] font-semibold leading-none',
        'transition-fast [transition-property:background-color,border-color]',
        readonly ? 'cursor-default' : 'cursor-pointer',
        disabled && 'cursor-not-allowed opacity-45',
        box,
        props.class,
      )
    "
    :aria-readonly="readonly || undefined"
  >
    <CheckboxIndicator
      v-if="tone !== 'queued' && tone !== 'held'"
      :force-mount="tone === 'error' || tone === 'success'"
    >
      <span aria-hidden="true">{{ mark }}</span>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
