<script setup lang="ts">
/** "?" overlay generated from the shortcut registry, grouped, with the active scope's shortcuts. */
import { formatKeys, useShortcuts } from '~/composables/useShortcuts'

const { overlayOpen, groups } = useShortcuts()
const isMac = import.meta.client ? /Mac|iPhone|iPad/.test(navigator.platform) : true
</script>

<template>
  <Dialog :open="overlayOpen" @update:open="(v) => (overlayOpen = v)">
    <DialogContent :width="720">
      <DialogHeader>
        <Eyebrow tone="accent">Keyboard</Eyebrow>
        <DialogTitle>Every flow works without a mouse.</DialogTitle>
        <DialogDescription
          >Shortcuts are disabled while you type, except ⌘⏎ and Esc.</DialogDescription
        >
      </DialogHeader>
      <div class="mt-6 grid grid-cols-2 gap-x-10 gap-y-6">
        <section v-for="g in groups" :key="g.name" class="flex flex-col gap-2">
          <Eyebrow>{{ g.name }}</Eyebrow>
          <ul class="divide-hairline flex flex-col">
            <li
              v-for="s in g.items"
              :key="s.id"
              class="flex items-center justify-between gap-4 py-[7px] text-small"
            >
              <span class="text-fg">{{ s.label }}</span>
              <Kbd :keys="formatKeys(s.keys, isMac)" />
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
