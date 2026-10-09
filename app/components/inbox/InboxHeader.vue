<script setup lang="ts">
/**
 * Inbox header: serif title, summary line, the mailbox menu, the ⌘K search box (opens the palette)
 * and the 3-dot menu (Regenerate all unsent drafts).
 */
import { useShortcuts } from '~/composables/useShortcuts'

defineProps<{ summary: string; draftCount: number }>()
const emit = defineEmits<{ regenerateAll: [] }>()
const { paletteOpen } = useShortcuts()
</script>

<template>
  <div class="flex items-end justify-between gap-8">
    <div class="flex flex-col gap-[10px]">
      <h1 class="type-display">Inbox</h1>
      <p class="text-body leading-[1.6] text-fg-muted">{{ summary }}</p>
    </div>
    <div class="flex items-center gap-2">
      <InboxMailboxMenu />
      <button
        type="button"
        class="flex w-[320px] items-center justify-between gap-6 rounded-md border border-line px-[10px] py-2 text-left text-small text-fg-muted transition-fast hover:border-line-strong hover:text-fg"
        @click="paletteOpen = true"
      >
        <span>Search all tickets</span><Kbd keys="⌘K" />
      </button>
      <MoreMenu label="Inbox options">
        <DropdownMenuItem
          :disabled="draftCount === 0"
          :description="
            draftCount === 0
              ? 'No unsent draft waits for a decision'
              : 'Every unsent reply is drafted again with the current templates and settings'
          "
          @select="emit('regenerateAll')"
          >Regenerate all drafts<template v-if="draftCount > 0">
            · {{ draftCount }}</template
          ></DropdownMenuItem
        >
      </MoreMenu>
    </div>
  </div>
</template>
