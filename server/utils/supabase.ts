/**
 * Service-role Supabase client for server code (bypasses RLS). Only server code may import this.
 * Route handlers that act on behalf of the signed-in user can use `serverSupabaseClient(event)` from
 * `#supabase/server` instead, which respects RLS.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '#shared/types/database'

export type MaelleDb = SupabaseClient<Database>

let cached: MaelleDb | null = null

export function useServiceDb(): MaelleDb {
  if (cached) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    })
  }
  cached = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
