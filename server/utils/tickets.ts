/**
 * Ticket id resolution shared by routes: `:id` may be the uuid or the display number ("4825" or
 * "#4825"). Returns the uuid, or throws 404.
 */
import { dbOne, isDbConfigured } from './db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export async function resolveTicketId(idOrNumber: string): Promise<string> {
  const raw = decodeURIComponent(idOrNumber ?? '')
    .trim()
    .replace(/^#/, '')
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Ticket id is required' })
  if (looksLikeUuid(raw)) return raw.toLowerCase()
  if (!/^\d+$/.test(raw)) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not configured (SUPABASE_DB_URL).',
    })
  }
  const row = await dbOne<{ id: string }>(
    'select id from public.tickets where display_number = $1::int limit 1',
    [Number(raw)],
  )
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return row.id
}
