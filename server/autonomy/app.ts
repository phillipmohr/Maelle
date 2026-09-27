/** The InstaRadar app row (Maelle has one app today). Cached for a minute. */
import { dbOne } from '../utils/db'

let cached: { id: string; at: number } | null = null

export async function currentAppId(): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.id
  const row = await dbOne<{ id: string }>(
    `select id from public.apps order by (key = 'instaradar') desc, created_at asc limit 1`,
  )
  if (!row) throw new Error('No app row in public.apps; run pnpm db:seed')
  cached = { id: row.id, at: Date.now() }
  return row.id
}

/** Tests only. */
export function resetAppIdCache(): void {
  cached = null
}

/** Postgres returns timestamptz as Date; the API speaks ISO strings. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}
