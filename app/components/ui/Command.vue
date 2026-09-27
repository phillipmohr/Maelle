<script setup lang="ts">
/**
 * Command (⌘K palette body). Keyboard navigation comes from reka-ui's Listbox; filtering is text
 * based and provided to CommandItem/CommandEmpty. Compose: Command > CommandInput + CommandList >
 * CommandGroup > CommandItem. `select` fires with the item's value.
 */
import { ListboxRoot } from 'reka-ui'
import { computed, provide, ref } from 'vue'
import { COMMAND_KEY } from '~/composables/commandContext'
import { cn } from '~/utils/cn'

const props = defineProps<{ class?: string }>()
const emit = defineEmits<{ select: [value: string] }>()

const query = ref('')
const items = ref(new Map<string, string>())

function matches(text: string): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  const words = q.split(/\s+/)
  const hay = text.toLowerCase()
  return words.every((w) => hay.includes(w))
}

const visibleCount = computed(() => [...items.value.values()].filter(matches).length)

provide(COMMAND_KEY, {
  query,
  registerItem: (id, text) => {
    items.value.set(id, text)
  },
  unregisterItem: (id) => {
    items.value.delete(id)
  },
  matches,
  visibleCount,
})

const model = ref<string | undefined>(undefined)

function onSelect(v: unknown) {
  if (typeof v === 'string') emit('select', v)
}
</script>

<template>
  <ListboxRoot
    v-model="model"
    selection-behavior="replace"
    highlight-on-hover
    :class="
      cn(
        'flex flex-col overflow-hidden rounded-lg border border-line bg-elevated shadow-lamp',
        props.class,
      )
    "
    @update:model-value="onSelect"
  >
    <slot />
  </ListboxRoot>
</template>
