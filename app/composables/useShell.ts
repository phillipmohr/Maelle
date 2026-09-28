/**
 * Shell state shared by the layout and pages: focus mode (list collapsed), context panel, inbox
 * count for the rail, the automation note. Persisted per browser, restored after hydration so the
 * server-rendered markup and the first client render match.
 */
import { watch } from 'vue'

export function useShell() {
  const focusMode = useState<boolean>('shell.focusMode', () => false)
  const contextOpen = useState<boolean>('shell.contextOpen', () => true)
  const inboxCount = useState<number>('shell.inboxCount', () => 0)
  const automationNote = useState<string>('shell.automationNote', () => 'Everything waits for you.')

  if (import.meta.client) {
    const hydrated = useState<boolean>('shell.hydrated', () => false)
    if (!hydrated.value) {
      hydrated.value = true
      onNuxtReady(() => {
        try {
          const saved = localStorage.getItem('maelle.shell')
          if (saved) {
            const s = JSON.parse(saved) as { focusMode?: boolean; contextOpen?: boolean }
            if (typeof s.focusMode === 'boolean') focusMode.value = s.focusMode
            if (typeof s.contextOpen === 'boolean') contextOpen.value = s.contextOpen
          }
        } catch {
          /* ignore */
        }
        watch([focusMode, contextOpen], ([f, c]) => {
          try {
            localStorage.setItem('maelle.shell', JSON.stringify({ focusMode: f, contextOpen: c }))
          } catch {
            /* ignore */
          }
        })
      })
    }
  }

  return {
    focusMode,
    contextOpen,
    inboxCount,
    automationNote,
    toggleFocusMode: () => (focusMode.value = !focusMode.value),
    toggleContext: () => (contextOpen.value = !contextOpen.value),
  }
}
