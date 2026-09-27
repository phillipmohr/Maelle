/**
 * Supabase Auth admin for InstaRadar accounts. InstaRadar's users live in InstaRadar's Supabase
 * project, not in Maelle's, so this uses INSTARADAR_SUPABASE_URL + INSTARADAR_SUPABASE_SERVICE_ROLE_KEY
 * (never `useServiceDb()`, which is Maelle's own project). Assumption, documented in
 * docs/instaradar/: `auth.users.id` equals the `instaradar_user_id` Maelle stores on the ticket.
 */
import { createClient } from '@supabase/supabase-js'
import { ProviderError } from '../errors'

export interface AuthAdminClient {
  getUser(userId: string): Promise<{ id: string; email: string | null } | null>
  deleteUser(userId: string): Promise<void>
}

export function createSupabaseAuthAdmin(url: string, serviceRoleKey: string): AuthAdminClient {
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async getUser(userId) {
      const { data, error } = await supabase.auth.admin.getUserById(userId)
      if (error) {
        if (error.status === 404) return null
        throw new ProviderError('Supabase', error.message, {
          code: error.code ?? null,
          statusCode: error.status ?? null,
          retryable: (error.status ?? 0) >= 500,
          cause: error,
        })
      }
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null
    },
    async deleteUser(userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error && error.status !== 404) {
        throw new ProviderError('Supabase', error.message, {
          code: error.code ?? null,
          statusCode: error.status ?? null,
          retryable: (error.status ?? 0) >= 500,
          cause: error,
        })
      }
    },
  }
}

export interface FakeAuthAdmin extends AuthAdminClient {
  readonly state: { users: Map<string, { id: string; email: string | null }> }
  readonly calls: { op: string; args: unknown[] }[]
  failNext(op: 'getUser' | 'deleteUser', error: ProviderError): void
  addUser(id: string, email: string | null): void
  reset(): void
}

export function createFakeAuthAdmin(): FakeAuthAdmin {
  const state: FakeAuthAdmin['state'] = { users: new Map() }
  const calls: FakeAuthAdmin['calls'] = []
  const failures = new Map<string, ProviderError>()
  function record(op: string, args: unknown[]) {
    calls.push({ op, args })
    const f = failures.get(op)
    if (f) {
      failures.delete(op)
      throw f
    }
  }
  return {
    state,
    calls,
    failNext(op, error) {
      failures.set(op, error)
    },
    addUser(id, email) {
      state.users.set(id, { id, email })
    },
    reset() {
      state.users.clear()
      calls.length = 0
      failures.clear()
    },
    async getUser(userId) {
      record('getUser', [userId])
      return state.users.get(userId) ?? null
    },
    async deleteUser(userId) {
      record('deleteUser', [userId])
      state.users.delete(userId)
    },
  }
}
