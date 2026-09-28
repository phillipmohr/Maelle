/**
 * InstaRadar write client (INSTARADAR_DB_WRITE_URL). Two writes exist: block a profile (safety
 * removal) and delete a user's rows (account deletion). Table and column names are the InstaRadar
 * database's, fixed in `shared/config.ts` (`INSTARADAR.db`); the blocklist table itself is added by
 * the InstaRadar-side change in docs/instaradar/ (see the README, IRDR-457 section, for the role).
 */
import pg from 'pg'
import { INSTARADAR } from '#shared/config'
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

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i

/** Identifiers come from shared/config.ts, never from a request; still, only plain identifiers pass. */
function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Invalid InstaRadar identifier in config: ${name}`)
  return `"${name}"`
}

const DB = INSTARADAR.db
const SCHEMA = ident(DB.schema)
const BLOCKED = `${SCHEMA}.${ident(DB.blockedProfiles)}`
const TRACKED = `${SCHEMA}.${ident(DB.trackedProfiles)}`
const HANDLE = ident(DB.trackedHandleColumn)
/** Tables holding a user's rows, deleted in this order (children first). */
export const USER_TABLES: readonly { table: string; column: string }[] = DB.userTables

export function createInstaradarWriteClient(connectionString: string): InstaradarWriteClient {
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  })
  pool.on('error', (err) => console.error('[instaradar-db] pool error', err))

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
        for (const t of USER_TABLES) {
          const r = await pool.query<{ one: number }>(
            `select 1 as one from ${SCHEMA}.${ident(t.table)} where ${ident(t.column)}::text = $1 limit 1`,
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
          `insert into ${BLOCKED} (username, reason, source) values ($1, $2, $3)
           on conflict (username) do nothing`,
          [h, reason, source],
        )
        const del = await c.query(`delete from ${TRACKED} where lower(${HANDLE}) = $1`, [h])
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
        for (const t of USER_TABLES) {
          const r = await c.query(
            `delete from ${SCHEMA}.${ident(t.table)} where ${ident(t.column)}::text = $1`,
            [userId],
          )
          deleted[t.table] = r.rowCount ?? 0
          if ((r.rowCount ?? 0) > 0) found = true
        }
        return { deleted, found }
      }),
  }
}
