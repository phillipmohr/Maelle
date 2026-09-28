<script setup lang="ts">
/** App shell: rail on the left, the page fills the rest. Desktop only (frames are 1512 × 944). */
import type { AutonomyResponse } from '#shared/api'
import { useShell } from '~/composables/useShell'
import { useTicketList } from '~/composables/useTickets'

const { inboxCount, automationNote } = useShell()

// Awaited so the rail's count and note are in the server-rendered markup (no hydration mismatch).
const { data: list } = await useTicketList()
watch(
  list,
  (l) => {
    if (l) inboxCount.value = l.counts.needsDecision
  },
  { immediate: true },
)

const { data: autonomy } = await useFetch<AutonomyResponse>('/api/autonomy', { key: 'autonomy' })
watch(
  autonomy,
  (a) => {
    if (!a) return
    const n = a.onAutoCount
    automationNote.value = a.settings.globalPause
      ? 'Automation paused. Everything waits for you.'
      : n === 0
        ? 'Nothing on Auto yet. Everything waits for you.'
        : `${n} case type${n === 1 ? '' : 's'} on Auto. Everything else waits for you.`
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-dvh w-full min-w-[1024px] overflow-hidden bg-page text-fg">
    <ShellRail />
    <div class="flex min-w-0 flex-1">
      <slot />
    </div>
    <ShellShortcutOverlay />
    <ShellCommandPalette />
  </div>
</template>
