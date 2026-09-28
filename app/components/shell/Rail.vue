<script setup lang="ts">
/**
 * Rail (212px): Wordmark, app switcher (InstaRadar only for now), area AnastasAI, nav with Inbox
 * count, automation note, "? Shortcuts".
 */
import { useShell } from '~/composables/useShell'
import { useShortcuts } from '~/composables/useShortcuts'

const route = useRoute()
const { inboxCount, automationNote } = useShell()
const { overlayOpen } = useShortcuts()

const nav = computed(() => [
  {
    name: 'Inbox',
    to: '/anastasai',
    count: inboxCount.value,
    active: route.path === '/anastasai' || route.path.startsWith('/anastasai/t/'),
  },
  {
    name: 'Autonomy',
    to: '/anastasai/autonomy',
    count: null,
    active: route.path.startsWith('/anastasai/autonomy'),
  },
  {
    name: 'Activity log',
    to: '/anastasai/activity',
    count: null,
    active: route.path.startsWith('/anastasai/activity'),
  },
  {
    name: 'Playbook',
    to: '/anastasai/playbook',
    count: null,
    active: route.path.startsWith('/anastasai/playbook'),
  },
])
</script>

<template>
  <nav
    class="flex h-full w-[var(--rail-width)] shrink-0 flex-col gap-5 border-r border-line px-3 pb-4 pt-5"
    aria-label="Maelle"
  >
    <div class="px-2">
      <NuxtLink to="/anastasai" class="no-underline hover:no-underline"
        ><Wordmark :size="28"
      /></NuxtLink>
    </div>

    <DropdownMenu>
      <DropdownMenuTrigger
        class="flex w-full items-center justify-between rounded-md border border-line px-[10px] py-2 text-left outline-none transition-fast hover:border-line-strong focus-visible:outline"
        aria-label="Switch app"
      >
        <span class="flex flex-col gap-px">
          <span class="text-[11px] text-fg-muted">App</span>
          <span class="text-small font-semibold text-fg">InstaRadar</span>
        </span>
        <span
          class="mr-1 -mt-1 size-[6px] rotate-45 border-b-[1.5px] border-r-[1.5px] border-sand"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-[188px]">
        <DropdownMenuLabel>Apps</DropdownMenuLabel>
        <DropdownMenuItem>InstaRadar</DropdownMenuItem>
        <DropdownMenuItem disabled>More apps later</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <div class="flex flex-col gap-[2px]">
      <div class="px-[10px] pb-2"><Eyebrow tone="accent">AnastasAI</Eyebrow></div>
      <NuxtLink
        v-for="n in nav"
        :key="n.name"
        :to="n.to"
        :aria-current="n.active ? 'page' : undefined"
        :class="[
          'flex items-center justify-between rounded-md px-[10px] py-[7px] text-small font-medium no-underline transition-fast hover:no-underline',
          n.active ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
        ]"
      >
        <span>{{ n.name }}</span>
        <span v-if="n.count != null && n.count > 0" class="font-mono text-[11px] text-fg-muted">{{
          n.count
        }}</span>
      </NuxtLink>
    </div>

    <div class="flex-1" />

    <div class="flex flex-col gap-[6px] border-t border-line px-[10px] py-3">
      <Eyebrow>Automation</Eyebrow>
      <span class="text-caption leading-[1.45] text-fg-muted">{{ automationNote }}</span>
    </div>

    <button
      type="button"
      class="flex items-center gap-2 px-[10px] text-left text-caption text-fg-muted hover:text-fg"
      @click="overlayOpen = true"
    >
      <Kbd keys="?" tone="muted" />Shortcuts
    </button>
  </nav>
</template>
