<script setup lang="ts">
/**
 * ⌘K palette: search names, emails and ticket ids; run page commands and go to pages.
 * Pages add commands via useCommands(); the search hits /api/tickets?q=.
 */
import type { TicketListResponse } from '#shared/api'
import { caseShortLabel } from '#shared/case-types'
import { formatKeys, useShortcuts } from '~/composables/useShortcuts'
import { useCommands } from '~/composables/useCommands'
import { useShell } from '~/composables/useShell'

const { paletteOpen } = useShortcuts()
const { available, register } = useCommands()
const { toggleFocusMode, toggleContext } = useShell()

register([
  {
    id: 'nav.inbox',
    label: 'Go to Inbox',
    group: 'Go to',
    keys: 'g i',
    run: () => navigateTo('/anastasai'),
  },
  {
    id: 'nav.closed',
    label: 'Go to closed tickets',
    group: 'Go to',
    keys: 'g h',
    run: () => navigateTo('/anastasai#closed'),
  },
  {
    id: 'nav.autonomy',
    label: 'Go to Autonomy',
    group: 'Go to',
    keys: 'g a',
    run: () => navigateTo('/anastasai/autonomy'),
  },
  {
    id: 'nav.activity',
    label: 'Go to Activity log',
    group: 'Go to',
    keys: 'g l',
    run: () => navigateTo('/anastasai/activity'),
  },
  {
    id: 'nav.playbook',
    label: 'Go to Playbook',
    group: 'Go to',
    keys: 'g p',
    run: () => navigateTo('/anastasai/playbook'),
  },
  {
    id: 'view.focus',
    label: 'Toggle focus mode (hide the list)',
    group: 'View',
    run: toggleFocusMode,
  },
  { id: 'view.context', label: 'Toggle customer context panel', group: 'View', run: toggleContext },
])

const { data } = useFetch<TicketListResponse>('/api/tickets', {
  key: 'palette:tickets',
  server: false,
  lazy: true,
  immediate: false,
})
watch(paletteOpen, (open) => {
  if (open && !data.value) refreshNuxtData('palette:tickets')
})

const tickets = computed(() => data.value?.items ?? [])
const groups = computed(() => {
  const map = new Map<string, typeof available.value>()
  for (const c of available.value) {
    const g = c.group ?? 'Commands'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(c)
  }
  return [...map.entries()]
})

function onSelect(value: string) {
  paletteOpen.value = false
  if (value.startsWith('ticket:')) {
    navigateTo(`/anastasai/t/${value.slice('ticket:'.length)}`)
    return
  }
  const cmd = available.value.find((c) => c.id === value)
  void cmd?.run()
}
</script>

<template>
  <CommandDialog
    :open="paletteOpen"
    title="Search or run a command"
    @update:open="(v) => (paletteOpen = v)"
    @select="onSelect"
  >
    <CommandInput placeholder="Search names, emails, ticket ids or commands" />
    <CommandList>
      <CommandEmpty>Nothing matches.</CommandEmpty>
      <CommandGroup v-for="[name, cmds] in groups" :key="name" :heading="name">
        <CommandItem
          v-for="c in cmds"
          :key="c.id"
          :value="c.id"
          :text="`${c.label} ${name}`"
          :keys="c.keys ? formatKeys(c.keys).join(' ') : undefined"
        >
          {{ c.label }}
        </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Tickets">
        <CommandItem
          v-for="t in tickets"
          :key="t.id"
          :value="`ticket:${t.displayNumber}`"
          :text="`#${t.displayNumber} ${t.customerName ?? ''} ${t.customerEmail} ${t.subject ?? ''} ${t.caseType ? caseShortLabel(t.caseType) : ''}`"
        >
          <Mono class="shrink-0">#{{ t.displayNumber }}</Mono>
          <span class="truncate font-semibold">{{ t.customerName ?? t.customerEmail }}</span>
          <span class="truncate text-fg-muted">{{
            t.caseType ? caseShortLabel(t.caseType) : 'Classifying…'
          }}</span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
