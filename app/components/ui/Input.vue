<script setup lang="ts">
/** Text input. Same surface language as Textarea. */
import { cn } from '~/utils/cn'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    id?: string
    name?: string
    autocomplete?: string
    autofocus?: boolean
    class?: string
  }>(),
  { modelValue: '', type: 'text', disabled: false, readonly: false, autofocus: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input
    :id="id"
    :name="name"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :autocomplete="autocomplete"
    :autofocus="autofocus"
    :class="
      cn(
        'block h-[38px] w-full rounded-md border border-line bg-inset px-3 font-sans text-small text-fg outline-none',
        'transition-fast [transition-property:border-color] focus:border-line-strong focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        props.class,
      )
    "
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
