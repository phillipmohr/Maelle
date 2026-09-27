<script setup lang="ts">
/** Textarea. Inset surface, hairline border that turns sand on focus, 14/1.6 body text. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    rows?: number
    disabled?: boolean
    readonly?: boolean
    id?: string
    name?: string
    autofocus?: boolean
    class?: string
  }>(),
  { modelValue: '', rows: 6, disabled: false, readonly: false, autofocus: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <textarea
    :id="id"
    :name="name"
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    :disabled="disabled"
    :readonly="readonly"
    :autofocus="autofocus"
    :class="
      cn(
        'block w-full resize-y rounded-md border border-line bg-inset px-4 py-3 font-sans text-body leading-[1.6] text-fg outline-none',
        'transition-fast [transition-property:border-color] focus:border-line-strong focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        props.class,
      )
    "
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
