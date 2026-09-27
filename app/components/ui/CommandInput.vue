<script setup lang="ts">
import { ListboxFilter } from 'reka-ui'
import { inject } from 'vue'
import { COMMAND_KEY } from '~/composables/commandContext'
import { cn } from '~/utils/cn'

const props = withDefaults(defineProps<{ placeholder?: string; class?: string }>(), {
  placeholder: 'Search or run a command',
})
const ctx = inject(COMMAND_KEY)!
</script>

<template>
  <div class="flex items-center gap-3 border-b border-line px-4">
    <span class="size-[6px] rounded-pill bg-gilt" aria-hidden="true" />
    <ListboxFilter
      v-model="ctx.query.value"
      auto-focus
      :placeholder="placeholder"
      :class="
        cn(
          'h-12 w-full bg-transparent font-sans text-subject text-fg outline-none placeholder:text-fg-muted',
          props.class,
        )
      "
    />
    <Kbd keys="Esc" tone="muted" />
  </div>
</template>
