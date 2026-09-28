/**
 * InstaRadar's Supabase (Postgres), read only. The real adapter connects with
 * INSTARADAR_DB_READ_URL, a role that has SELECT only. On top of that every connection sets
 * `default_transaction_read_only = on` and a statement timeout, and the ad-hoc tool only accepts a
 * single SELECT statement with a forced LIMIT (see `guardSelect`).
 *
 * Table and column names are the InstaRadar database's, fixed in shared/config.ts (INSTARADAR.db).
 */
import pg from 'pg'
import { INSTARADAR } from '#shared/config'
import type {
  InstaradarAlert,
  InstaradarProfileLookup,
  InstaradarReadClient,
  InstaradarScan,
  InstaradarSignIn,
  InstaradarTrackedProfile,
  InstaradarUser,
  InstaradarBundle,
  SelectResult,
} from '../types'
import type { FakeOptions } from './stripe'

export const SELECT_MAX_ROWS = 200
export const SELECT_STATEMENT_TIMEOUT_MS = 8_000

/**
 * Validates an ad-hoc query from the model. Throws when the statement is anything but one SELECT.
 * Returns the statement with a LIMIT applied (added when missing, capped otherwise).
 */
export function guardSelect(sql: string, maxRows: number = SELECT_MAX_ROWS): string {
  let s = sql.trim()
  if (s.endsWith(';')) s = s.slice(0, -1).trim()
  if (!/^select\b/i.test(s) && !/^with\b/i.test(s))
    throw new Error('Only a single SELECT statement is allowed')
  if (s.includes(';')) throw new Error('Only a single statement is allowed (no semicolons)')
  if (/--|\/\*/.test(s)) throw new Error('Comments are not allowed')
  const forbidden =
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|lock|listen|notify|refresh|reindex|cluster|comment|call|do|execute|prepare|deallocate|set|reset|show|begin|commit|rollback|savepoint|dblink)\b|\b(pg_sleep|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_notify|nextval|setval|lo_import|lo_export|lo_unlink|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_file_write|pg_advisory_lock|pg_advisory_xact_lock|pg_try_advisory_lock|txid_current)\s*\(/i
  const m = forbidden.exec(s)
  if (m) throw new Error(`Forbidden keyword in query: ${m[1] ?? m[2]}`)
  if (/\bfor\s+(update|share|no key update|key share)\b/i.test(s))
    throw new Error('Row locks are not allowed')
  if (/\binto\b/i.test(s) && !/\binto\s+(strict\s+)?\w+\s*\(/i.test(s))
    throw new Error('SELECT INTO is not allowed')
  const limitMatch = /\blimit\s+(\d+)\s*$/i.exec(s)
  if (limitMatch) {
    const n = Number(limitMatch[1])
    if (n > maxRows) s = s.slice(0, limitMatch.index) + `limit ${maxRows}`
  } else if (/\blimit\b/i.test(s)) {
    throw new Error(`LIMIT must be a plain number at the end of the query (max ${maxRows})`)
  } else {
    s = `${s} limit ${maxRows}`
  }
  return s
}

export function createInstaradarReadClient(readUrl: string): InstaradarReadClient {
  const pool = new pg.Pool({
    connectionString: readUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Belt and braces on top of the SELECT-only role: read-only transactions and a statement timeout.
    options: `-c default_transaction_read_only=on -c statement_timeout=${SELECT_STATEMENT_TIMEOUT_MS}`,
    ssl: /sslmode=require/.test(readUrl) ? { rejectUnauthorized: false } : undefined,
  })
  pool.on('error', (err) => console.error('[agent:instaradar] pool error', err))

  const q = async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) =>
    (await pool.query<T>(text, params)).rows

  // The InstaRadar schema (shared/config.ts): profile (auth user id, email, stripe customer),
  // subscription (plan, status), tracked_profiles (instagram_username), scan_history and
  // notification_log hang off tracked_profiles / user_id. Sign-ins come from Supabase's auth log.
  const T = INSTARADAR.db
  const profiles = `${T.schema}.${T.profiles}`
  const subscriptions = `${T.schema}.${T.subscriptions}`
  const tracked = `${T.schema}.${T.trackedProfiles}`
  const handleCol = T.trackedHandleColumn
  const scans = `${T.schema}.${T.scanHistory}`
  const notifications = `${T.schema}.${T.notificationLog}`
  const blocked = `${T.schema}.${T.blockedProfiles}`
  const sinceParam = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

  return {
    configured: true,
    async findUserByEmail(email) {
      const rows = await q<Record<string, unknown>>(
        `select p.id, p.email, s.plan::text as plan, s.status::text as status, p.created_at,
                coalesce(s.stripe_customer_id, p.stripe_customer_id) as stripe_customer_id
         from ${profiles} p
         left join lateral (
           select plan, status, stripe_customer_id from ${subscriptions} s
           where s.user_id = p.id order by s.created_at desc limit 1
         ) s on true
         where lower(p.email) = lower($1) limit 1`,
        [email],
      )
      const r = rows[0]
      if (!r) return null
      // auth.users needs its own grant for the read role; without it only the last sign-in is missing.
      const lastSignInAt = await q<{ at: string | null }>(
        `select last_sign_in_at as at from auth.users where id::text = $1`,
        [String(r.id)],
      )
        .then((x) => x[0]?.at ?? null)
        .catch(() => null)
      return {
        id: String(r.id),
        email: String(r.email),
        plan: r.plan == null ? null : String(r.plan),
        status: r.status == null ? null : String(r.status),
        createdAt: new Date(String(r.created_at)).toISOString(),
        stripeCustomerId: r.stripe_customer_id == null ? null : String(r.stripe_customer_id),
        lastSignInAt: lastSignInAt ? new Date(String(lastSignInAt)).toISOString() : null,
      }
    },
    async listTrackedProfiles(userId) {
      const rows = await q<Record<string, unknown>>(
        `select tracked_profile_id as id, ${handleCol} as handle, created_at as since, is_active as active
         from ${tracked} where user_id::text = $1 order by created_at limit 100`,
        [userId],
      )
      return rows.map((r) => ({
        id: String(r.id),
        handle: String(r.handle).replace(/^@/, ''),
        since: new Date(String(r.since)).toISOString(),
        active: r.active == null ? true : Boolean(r.active),
      }))
    },
    async listSignIns(userId, days) {
      const rows = await q<Record<string, unknown>>(
        `select created_at as at, payload->>'action' as action
         from auth.audit_log_entries where payload->>'actor_id' = $1 and created_at >= $2
         order by created_at desc limit 500`,
        [userId, sinceParam(days)],
      )
      return rows.map((r) => ({
        at: new Date(String(r.at)).toISOString(),
        action: r.action == null ? null : String(r.action),
      }))
    },
    async listScans(userId, days) {
      const rows = await q<Record<string, unknown>>(
        `select coalesce(h.scanned_at, h.created_at) as at, t.${handleCol} as handle, h.status::text as status,
                coalesce(h.error_message, h.error_code) as error
         from ${scans} h join ${tracked} t on t.tracked_profile_id = h.tracked_profile_id
         where t.user_id::text = $1 and coalesce(h.scanned_at, h.created_at) >= $2
         order by 1 desc limit 500`,
        [userId, sinceParam(days)],
      )
      return rows.map((r) => ({
        at: new Date(String(r.at)).toISOString(),
        handle: r.handle == null ? null : String(r.handle),
        status: r.status == null ? null : String(r.status),
        error: r.error == null ? null : String(r.error),
      }))
    },
    async listAlerts(userId, days) {
      const rows = await q<Record<string, unknown>>(
        `select coalesce(l.sent_at, l.created_at) as at, t.${handleCol} as handle, l.event_type::text as type
         from ${notifications} l left join ${tracked} t on t.tracked_profile_id = l.tracked_profile_id
         where l.user_id::text = $1 and l.created_at >= $2
         order by 1 desc limit 500`,
        [userId, sinceParam(days)],
      )
      return rows.map((r) => ({
        at: new Date(String(r.at)).toISOString(),
        handle: r.handle == null ? null : String(r.handle),
        type: r.type == null ? null : String(r.type),
      }))
    },
    async lookupProfile(handle) {
      const h = handle.replace(/^@/, '').toLowerCase()
      const [trackedRows, blockedRows] = await Promise.all([
        q<{ n: string }>(
          `select count(*)::text as n from ${tracked} where lower(${handleCol}) = $1 and is_active`,
          [h],
        ),
        // The blocklist table arrives with the InstaRadar-side change; until then nothing is blocked.
        q<{ n: string }>(`select count(*)::text as n from ${blocked} where username = $1`, [
          h,
        ]).catch(() => [{ n: '0' }]),
      ])
      const trackedByUsers = Number(trackedRows[0]?.n ?? 0)
      const isBlocked = Number(blockedRows[0]?.n ?? 0) > 0
      if (trackedByUsers === 0 && !isBlocked) return null
      return { handle: h, trackedByUsers, blocked: isBlocked }
    },
    async select(sql) {
      const safe = guardSelect(sql)
      const res = await pool.query(safe)
      const rows = res.rows as Record<string, unknown>[]
      return {
        columns: res.fields.map((f) => f.name),
        rows,
        rowCount: rows.length,
        truncated: rows.length >= SELECT_MAX_ROWS,
      }
    },
  }
}

// ---------------------------------------------------------------- fake

export interface FakeInstaradarData {
  users?: InstaradarUser[]
  trackedProfiles?: (InstaradarTrackedProfile & { userId: string })[]
  signIns?: (InstaradarSignIn & { userId: string })[]
  scans?: (InstaradarScan & { userId: string })[]
  alerts?: (InstaradarAlert & { userId: string })[]
  /** Profiles known platform-wide (for safety / removal lookups). */
  profiles?: InstaradarProfileLookup[]
  /** Canned answers for ad-hoc selects, matched by substring of the query. */
  selects?: { match: string; result: SelectResult }[]
}

export function createFakeInstaradarReadClient(
  data: FakeInstaradarData = {},
  opts: FakeOptions = {},
): InstaradarReadClient & { calls: string[] } {
  const calls: string[] = []
  const guard = (method: string) => {
    calls.push(method)
    if (opts.fail || opts.failMethods?.includes(method))
      throw new Error(opts.fail ?? `instaradar ${method} failed (fake)`)
  }
  const forUser = <T extends { userId: string }>(list: T[] | undefined, id: string): T[] =>
    (list ?? []).filter((x) => x.userId === id)
  return {
    calls,
    configured: !opts.unconfigured,
    async findUserByEmail(email) {
      guard('findUserByEmail')
      return (
        (data.users ?? []).find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? null
      )
    },
    async listTrackedProfiles(userId) {
      guard('listTrackedProfiles')
      return forUser(data.trackedProfiles, userId)
    },
    async listSignIns(userId) {
      guard('listSignIns')
      return forUser(data.signIns, userId)
    },
    async listScans(userId) {
      guard('listScans')
      return forUser(data.scans, userId)
    },
    async listAlerts(userId) {
      guard('listAlerts')
      return forUser(data.alerts, userId)
    },
    async lookupProfile(handle) {
      guard('lookupProfile')
      const h = handle.replace(/^@/, '').toLowerCase()
      const known = (data.profiles ?? []).find((p) => p.handle.toLowerCase() === h)
      if (known) return known
      const trackedByUsers = (data.trackedProfiles ?? []).filter(
        (p) => p.handle.toLowerCase() === h,
      ).length
      return trackedByUsers > 0 ? { handle: h, trackedByUsers, blocked: false } : null
    },
    async select(sql) {
      guard('select')
      const safe = guardSelect(sql)
      const canned = (data.selects ?? []).find((s) =>
        safe.toLowerCase().includes(s.match.toLowerCase()),
      )
      return canned?.result ?? { columns: [], rows: [], rowCount: 0, truncated: false }
    },
  }
}

/** Extract @handles mentioned in a text (Instagram usernames). */
export function extractHandles(text: string): string[] {
  const out = new Set<string>()
  const re = /(?:^|[\s(,:;"'])@([a-zA-Z0-9._]{2,30})(?![a-zA-Z0-9._])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const h = m[1]!.toLowerCase().replace(/\.$/, '')
    // Skip anything that looks like an email domain fragment.
    if (h.includes('..')) continue
    out.add(h)
  }
  return [...out]
}

export async function loadInstaradarBundle(
  client: InstaradarReadClient,
  emails: string[],
  knownUserId: string | null,
  mentionedHandles: string[],
): Promise<InstaradarBundle> {
  let user = null
  for (const email of emails) {
    user = await client.findUserByEmail(email)
    if (user) break
  }
  const userId = user?.id ?? knownUserId
  const [trackedProfiles, signIns, scans, alerts] = userId
    ? await Promise.all([
        client.listTrackedProfiles(userId),
        client.listSignIns(userId, 120),
        client.listScans(userId, 30),
        client.listAlerts(userId, 30),
      ])
    : [[], [], [], []]
  const mentionedProfiles = (
    await Promise.all(mentionedHandles.slice(0, 5).map((h) => client.lookupProfile(h)))
  ).filter((p): p is InstaradarProfileLookup => p !== null)
  return { user, trackedProfiles, signIns, scans, alerts, mentionedProfiles }
}
