/**
 * InstaRadar write client (INSTARADAR_DB_WRITE_URL). Two writes exist: block a profile (safety
 * removal) and delete a user's rows (account deletion). Table and column names are configurable
 * because the InstaRadar repo is not reachable from Maelle; the defaults match the proposal in
 * docs/instaradar/ (see README, IRDR-457 section, for the assumptions and the role's grants).
 */
import pg from 'pg'
import { fromPgError } from '../errors'

export interface InstaradarBlockResult {
  handle: string
  alreadyBlocked: boolean
  /** Tracking rows removed for this profile, across all users. */
  trackingStopped: number
}

export interface InstaradarDeleteResult {
  /** Rows deleted per table. */
  deleted: Record<string, number>
  /** False when no row referenced the user in any configured table. */
  found: boolean
}

export interface InstaradarWriteClient {
  /** True when any configured user table still references the user. */
  userExists(userId: string): Promise<boolean>
  /** Blocks the handle for tracking and viewing, and stops existing tracking by all users. One transaction. */
  blockProfile(handle: string, reason: string, source: string): Promise<InstaradarBlockResult>
  /** Deletes the user's rows in every configured table. One transaction. */
  deleteUserData(userId: string): Promise<InstaradarDeleteResult>
}

export interface InstaradarTableConfig {
  schema: string
  blockedProfilesTable: string
  blockedHandleColumn: string
  blockedReasonColumn: string
  blockedSourceColumn: string
  trackedProfilesTable: string
  trackedHandleColumn: string
  /** Tables holding user rows, deleted in this order (children first): [{ table, column }]. */
  userTables: { table: string; column: string }[]
}

export const DEFAULT_INSTARADAR_TABLES: InstaradarTableConfig = {
  schema: 'public',
  blockedProfilesTable: 'blocked_profiles',
  blockedHandleColumn: 'username',
  blockedReasonColumn: 'reason',
  blockedSourceColumn: 'source',
  trackedProfilesTable: 'tracked_profiles',
  trackedHandleColumn: 'username',
  userTables: [
    { table: 'tracked_profiles', column: 'user_id' },
    { table: 'profiles', column: 'id' },
  ],
}

/** `INSTARADAR_USER_TABLES="tracked_profiles:user_id,profiles:id"` */
export function parseUserTables(value: string | undefined): { table: string; column: string }[] {
  if (!value?.trim()) return DEFAULT_INSTARADAR_TABLES.userTables
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [table, column] = pair.split(':')
      return { table: table!.trim(), column: (column ?? 'user_id').trim() }
    })
}

export function instaradarConfigFromEnv(
  env: Record<string, string | undefined>,
): InstaradarTableConfig {
  const d = DEFAULT_INSTARADAR_TABLES
  return {
    schema: env.INSTARADAR_DB_SCHEMA || d.schema,
    blockedProfilesTable: env.INSTARADAR_BLOCKED_PROFILES_TABLE || d.blockedProfilesTable,
    blockedHandleColumn: env.INSTARADAR_BLOCKED_HANDLE_COLUMN || d.blockedHandleColumn,
    blockedReasonColumn: env.INSTARADAR_BLOCKED_REASON_COLUMN || d.blockedReasonColumn,
    blockedSourceColumn: env.INSTARADAR_BLOCKED_SOURCE_COLUMN || d.blockedSourceColumn,
    trackedProfilesTable: env.INSTARADAR_TRACKED_PROFILES_TABLE || d.trackedProfilesTable,
    trackedHandleColumn: env.INSTARADAR_TRACKED_HANDLE_COLUMN || d.trackedHandleColumn,
    userTables: parseUserTables(env.INSTARADAR_USER_TABLES),
  }
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i

/** Identifiers come from env, never from a request; still, only plain identifiers are accepted. */
function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Invalid InstaRadar identifier in config: ${name}`)
  return `"${name}"`
}

export function createInstaradarWriteClient(
  connectionString: string,
  config: InstaradarTableConfig = DEFAULT_INSTARADAR_TABLES,
): InstaradarWriteClient {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  })
  pool.on('error', (err) => console.error('[instaradar-db] pool error', err))
  const s = ident(config.schema)
  const blocked = `${s}.${ident(config.blockedProfilesTable)}`
  const tracked = `${s}.${ident(config.trackedProfilesTable)}`

  async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('begin')
      const r = await fn(c)
      await c.query('commit')
      return r
    } catch (err) {
      await c.query('rollback').catch(() => {})
      throw fromPgError('InstaRadar', err)
    } finally {
      c.release()
    }
  }

  return {
    async userExists(userId) {
      try {
        for (const t of config.userTables) {
          const r = await pool.query<{ one: number }>(
            `select 1 as one from ${s}.${ident(t.table)} where ${ident(t.column)}::text = $1 limit 1`,
            [userId],
          )
          if (r.rowCount) return true
        }
        return false
      } catch (err) {
        throw fromPgError('InstaRadar', err)
      }
    },
    blockProfile: (handle, reason, source) =>
      tx(async (c) => {
        const h = handle.replace(/^@/, '').toLowerCase()
        const ins = await c.query(
          `insert into ${blocked} (${ident(config.blockedHandleColumn)}, ${ident(config.blockedReasonColumn)}, ${ident(config.blockedSourceColumn)})
           values ($1, $2, $3)
           on conflict (${ident(config.blockedHandleColumn)}) do nothing`,
          [h, reason, source],
        )
        const del = await c.query(
          `delete from ${tracked} where lower(${ident(config.trackedHandleColumn)}) = $1`,
          [h],
        )
        return {
          handle: h,
          alreadyBlocked: (ins.rowCount ?? 0) === 0,
          trackingStopped: del.rowCount ?? 0,
        }
      }),
    deleteUserData: (userId) =>
      tx(async (c) => {
        const deleted: Record<string, number> = {}
        let found = false
        for (const t of config.userTables) {
          const r = await c.query(
            `delete from ${s}.${ident(t.table)} where ${ident(t.column)}::text = $1`,
            [userId],
          )
          deleted[t.table] = r.rowCount ?? 0
          if ((r.rowCount ?? 0) > 0) found = true
        }
        return { deleted, found }
      }),
  }
}
