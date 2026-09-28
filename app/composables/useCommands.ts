/**
 * Command registry for the ⌘K palette. Pages register their commands (approve, snooze, reject,
 * change case, re-run research …) while mounted; the palette lists them next to ticket search.
 * Client only: commands hold functions, so they never go through the SSR payload.
 */
import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

export interface CommandDef {
  id: string
  label: string
  group?: string
  /** Shortcut hint, same syntax as useShortcuts. */
  keys?: string
  when?: () => boolean
  run: () => unknown
}

let registry: Ref<CommandDef[]> | null = null

function getRegistry(): Ref<CommandDef[]> {
  if (!registry) registry = ref([])
  return registry
}

export function useCommands() {
  const commands = getRegistry()

  function register(defs: CommandDef | CommandDef[]): () => void {
    if (import.meta.server) return () => {}
    const list = Array.isArray(defs) ? defs : [defs]
    commands.value = [...commands.value.filter((c) => !list.some((l) => l.id === c.id)), ...list]
    const dispose = () => {
      commands.value = commands.value.filter((c) => !list.some((l) => l.id === c.id))
    }
    if (getCurrentScope()) onScopeDispose(dispose)
    return dispose
  }

  const available = computed(() => commands.value.filter((c) => !c.when || c.when()))

  return { commands, available, register }
}

/** Tests only. */
export function resetCommandsForTests() {
  registry = null
}
