/**
 * Global shortcut registry. Key strings: single keys ("j", "a", "?", "enter", "escape"), chords
 * ("mod+k", "mod+enter", "shift+r"), sequences separated by spaces ("g i"). `mod` is ⌘ on macOS and
 * Ctrl elsewhere. Shortcuts are scoped: 'global' ones always fire, page ones only while their scope
 * is active (`useShortcutScope('ticket')`). While the user types in an input, only shortcuts with
 * `allowInInput` fire (mod+enter and escape have it by default). The "?" overlay is rendered from
 * this registry.
 */
import { getCurrentScope, onScopeDispose, ref, computed, type Ref } from 'vue'

export interface ShortcutDef {
  id: string
  keys: string
  label: string
  group?: string
  scope?: string
  /** Extra condition, e.g. "a ticket is selected". */
  when?: () => boolean
  allowInInput?: boolean
  /** Hidden from the "?" overlay. */
  hidden?: boolean
  handler: (event: KeyboardEvent) => void
}

interface Registered extends ShortcutDef {
  tokens: string[]
}

const SEQUENCE_TIMEOUT_MS = 900

function normalizeToken(token: string): string {
  const parts = token
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  const mods = { mod: false, shift: false, alt: false }
  let key = ''
  for (const p of parts) {
    if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl' || p === 'control')
      mods.mod = true
    else if (p === 'shift') mods.shift = true
    else if (p === 'alt' || p === 'option') mods.alt = true
    else
      key =
        p === 'esc'
          ? 'escape'
          : p === 'return'
            ? 'enter'
            : p === '⏎'
              ? 'enter'
              : p === '⌘k'
                ? 'k'
                : p
  }
  if (token.toLowerCase().startsWith('⌘')) mods.mod = true
  return `${mods.mod ? 'mod+' : ''}${mods.shift ? 'shift+' : ''}${mods.alt ? 'alt+' : ''}${key}`
}

export function tokensOf(keys: string): string[] {
  return keys.trim().split(/\s+/).map(normalizeToken)
}

export function eventToken(e: KeyboardEvent): string {
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === 'esc') key = 'escape'
  const mod = e.metaKey || e.ctrlKey
  // Shift is implied by punctuation such as "?" and by uppercase letters; keep it only for letters/others.
  const isPunctuation = key.length === 1 && !/[a-z0-9]/.test(key)
  const shift = e.shiftKey && !isPunctuation
  return `${mod ? 'mod+' : ''}${shift ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${key}`
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  return false
}

/** Pretty label for the overlay: "mod+k" → "⌘K", "g i" → "G I", "enter" → "⏎". */
export function formatKeys(keys: string, isMac = true): string[] {
  return tokensOf(keys).map((t) => {
    const parts = t.split('+')
    const key = parts.pop() ?? ''
    const symbols: Record<string, string> = {
      enter: '⏎',
      escape: 'Esc',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
      space: 'Space',
      backspace: '⌫',
      tab: 'Tab',
    }
    let out = ''
    if (parts.includes('mod')) out += isMac ? '⌘' : 'Ctrl+'
    if (parts.includes('shift')) out += isMac ? '⇧' : 'Shift+'
    if (parts.includes('alt')) out += isMac ? '⌥' : 'Alt+'
    out += symbols[key] ?? key.toUpperCase()
    return out
  })
}

interface Registry {
  shortcuts: Ref<Registered[]>
  activeScope: Ref<string>
  overlayOpen: Ref<boolean>
  paletteOpen: Ref<boolean>
  pending: string[]
  pendingTimer: ReturnType<typeof setTimeout> | null
}

let registry: Registry | null = null

function getRegistry(): Registry {
  if (!registry) {
    registry = {
      shortcuts: ref([]),
      activeScope: ref('global'),
      overlayOpen: ref(false),
      paletteOpen: ref(false),
      pending: [],
      pendingTimer: null,
    }
  }
  return registry
}

function clearPending(r: Registry) {
  r.pending = []
  if (r.pendingTimer) clearTimeout(r.pendingTimer)
  r.pendingTimer = null
}

/** Called by the client plugin for every keydown. Exported for tests. */
export function dispatchKeydown(e: KeyboardEvent): boolean {
  const r = getRegistry()
  const typing = isTypingTarget(e.target)
  const token = eventToken(e)
  // Modifier-only presses never count.
  if (['shift', 'meta', 'control', 'alt'].includes(e.key.toLowerCase())) return false

  const candidates = r.shortcuts.value.filter((s) => {
    if (s.scope && s.scope !== 'global' && s.scope !== r.activeScope.value) return false
    if (
      typing &&
      !(
        s.allowInInput ??
        (s.tokens.length === 1 && (s.tokens[0] === 'mod+enter' || s.tokens[0] === 'escape'))
      )
    )
      return false
    if (s.when && !s.when()) return false
    return true
  })

  const sequence = [...r.pending, token]
  const exact = candidates.filter(
    (s) => s.tokens.length === sequence.length && s.tokens.every((t, i) => t === sequence[i]),
  )
  const prefix = candidates.filter(
    (s) => s.tokens.length > sequence.length && sequence.every((t, i) => s.tokens[i] === t),
  )

  if (exact.length > 0 && prefix.length === 0) {
    clearPending(r)
    e.preventDefault()
    exact[0]!.handler(e)
    return true
  }
  if (prefix.length > 0) {
    // Wait for the rest of the sequence; a lone exact match wins if nothing follows.
    r.pending = sequence
    if (r.pendingTimer) clearTimeout(r.pendingTimer)
    r.pendingTimer = setTimeout(() => {
      const late = exact[0]
      clearPending(r)
      if (late) late.handler(e)
    }, SEQUENCE_TIMEOUT_MS)
    e.preventDefault()
    return true
  }
  if (r.pending.length > 0) {
    // Broken sequence: retry the key on its own.
    clearPending(r)
    return dispatchKeydown(e)
  }
  return false
}

export function useShortcuts() {
  const r = getRegistry()

  function register(defs: ShortcutDef | ShortcutDef[]): () => void {
    // Shortcuts only exist in the browser; during SSR the registry must not fill up across requests.
    if (import.meta.server) return () => {}
    const list = (Array.isArray(defs) ? defs : [defs]).map((d) => ({
      ...d,
      tokens: tokensOf(d.keys),
    }))
    r.shortcuts.value = [
      ...r.shortcuts.value.filter((s) => !list.some((l) => l.id === s.id)),
      ...list,
    ]
    const dispose = () => {
      r.shortcuts.value = r.shortcuts.value.filter((s) => !list.some((l) => l.id === s.id))
    }
    if (getCurrentScope()) onScopeDispose(dispose)
    return dispose
  }

  const visible = computed(() =>
    r.shortcuts.value.filter(
      (s) => !s.hidden && (!s.scope || s.scope === 'global' || s.scope === r.activeScope.value),
    ),
  )

  const groups = computed(() => {
    const map = new Map<string, Registered[]>()
    for (const s of visible.value) {
      const g = s.group ?? 'Other'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s)
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }))
  })

  return {
    register,
    shortcuts: r.shortcuts,
    visible,
    groups,
    activeScope: r.activeScope,
    overlayOpen: r.overlayOpen,
    paletteOpen: r.paletteOpen,
    dispatch: dispatchKeydown,
  }
}

/** Sets the active scope while the calling component is alive. */
export function useShortcutScope(scope: string) {
  const r = getRegistry()
  const previous = r.activeScope.value
  r.activeScope.value = scope
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (r.activeScope.value === scope) r.activeScope.value = previous
    })
  }
}

/** Tests only. */
export function resetShortcutsForTests() {
  registry = null
}
