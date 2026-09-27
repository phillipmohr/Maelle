import { dispatchKeydown, useShortcuts } from '~/composables/useShortcuts'

/** Installs the single keydown listener and the global shortcuts (?, ⌘K, G I …). */
export default defineNuxtPlugin(() => {
  const { register, overlayOpen, paletteOpen } = useShortcuts()

  window.addEventListener('keydown', (e) => {
    // Let the palette and dialogs own their keys when open.
    if (paletteOpen.value) return
    dispatchKeydown(e)
  })

  register([
    {
      id: 'global.help',
      keys: '?',
      label: 'Show shortcuts',
      group: 'Global',
      scope: 'global',
      handler: () => {
        overlayOpen.value = !overlayOpen.value
      },
    },
    {
      id: 'global.palette',
      keys: 'mod+k',
      label: 'Search or run a command',
      group: 'Global',
      scope: 'global',
      allowInInput: true,
      handler: () => {
        paletteOpen.value = true
      },
    },
    {
      id: 'global.inbox',
      keys: 'g i',
      label: 'Go to Inbox',
      group: 'Go to',
      scope: 'global',
      handler: () => navigateTo('/anastasai'),
    },
    {
      id: 'global.closed',
      keys: 'g h',
      label: 'Go to closed tickets',
      group: 'Go to',
      scope: 'global',
      handler: () => navigateTo('/anastasai#closed'),
    },
    {
      id: 'global.autonomy',
      keys: 'g a',
      label: 'Go to Autonomy',
      group: 'Go to',
      scope: 'global',
      handler: () => navigateTo('/anastasai/autonomy'),
    },
    {
      id: 'global.activity',
      keys: 'g l',
      label: 'Go to Activity log',
      group: 'Go to',
      scope: 'global',
      handler: () => navigateTo('/anastasai/activity'),
    },
    {
      id: 'global.playbook',
      keys: 'g p',
      label: 'Go to Playbook',
      group: 'Go to',
      scope: 'global',
      handler: () => navigateTo('/anastasai/playbook'),
    },
  ])
})
