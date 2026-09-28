/**
 * Supabase Realtime on tickets, agent_runs and action_executions: researching tickets turn ready
 * without a reload, the rail count updates, per-action results appear during execution.
 * A no-op in offline development (AUTH_DISABLED, or a placeholder Supabase URL), so there is no
 * console noise. Every step is guarded with try/catch.
 */
import { CLOSED_LIST_KEY, TICKET_LIST_KEY } from '~/composables/useTickets'

export type RealtimeTable = 'tickets' | 'agent_runs' | 'action_executions'
export type RealtimeListener = (table: RealtimeTable, payload: unknown) => void

/** Only a real https Supabase project URL is worth a websocket. */
export function isRealtimeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  if (!/^https:\/\//i.test(url)) return false
  if (/127\.0\.0\.1|localhost|\[::1\]|your-project\.supabase\.co/i.test(url)) return false
  return true
}

const listeners = new Set<RealtimeListener>()
let started = false
let timer: ReturnType<typeof setTimeout> | null = null

function notify(table: RealtimeTable, payload: unknown) {
  for (const l of listeners) {
    try {
      l(table, payload)
    } catch {
      /* a listener must never break the others */
    }
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    refreshNuxtData([TICKET_LIST_KEY, CLOSED_LIST_KEY]).catch(() => {})
  }, 300)
}

export function useRealtime() {
  const config = useRuntimeConfig()
  const supabaseUrl = (config.public as { supabase?: { url?: string } }).supabase?.url
  // Without a session (AUTH_DISABLED in dev) RLS would deliver nothing anyway; skip the websocket.
  const enabled = import.meta.client && !config.public.authDisabled && isRealtimeUrl(supabaseUrl)

  function start() {
    if (!enabled || started) return
    started = true
    try {
      const client = useSupabaseClient()
      const channel = client.channel('maelle')
      for (const table of ['tickets', 'agent_runs', 'action_executions'] as RealtimeTable[]) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload: unknown) => notify(table, payload),
        )
      }
      channel.subscribe()
    } catch {
      started = false
    }
  }

  /** Called for every change; disposed with the calling component. */
  function onChange(listener: RealtimeListener): () => void {
    listeners.add(listener)
    const dispose = () => listeners.delete(listener)
    if (getCurrentScope()) onScopeDispose(dispose)
    return dispose
  }

  if (import.meta.client) onNuxtReady(start)

  return { enabled, start, onChange }
}
