/**
 * Small database abstraction for the mail pipeline and the job runner (IRDR-455).
 *
 * Production code uses `poolDb()` (the pg pool from server/utils/db.ts on SUPABASE_DB_URL). Tests
 * pass `clientDb(client, { nested: true })` bound to one connection inside an open transaction, so
 * everything a test writes is rolled back and never visible to other test files that run in
 * parallel against the same database. Nested `transaction()` calls become savepoints.
 */
import type pg from 'pg'
import { getPool, withTransaction } from '../utils/db'

export interface Db {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
  one<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T | null>
  /** Runs `fn` atomically. Inside an existing transaction this is a savepoint. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

/** A `Db` over one connection. `nested: true` when the caller already opened a transaction. */
export function clientDb(client: pg.ClientBase, opts: { nested?: boolean } = {}): Db {
  let level = 0
  const db: Db = {
    async query(text, params = []) {
      const res = await client.query(text, params as unknown[])
      return res.rows
    },
    async one<T extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const rows = await db.query<T>(text, params)
      return rows[0] ?? null
    },
    async transaction(fn) {
      const useSavepoint = opts.nested || level > 0
      const name = `maelle_sp_${level}`
      await client.query(useSavepoint ? `savepoint ${name}` : 'begin')
      level++
      try {
        const result = await fn(db)
        await client.query(useSavepoint ? `release savepoint ${name}` : 'commit')
        return result
      } catch (e) {
        await client
          .query(useSavepoint ? `rollback to savepoint ${name}` : 'rollback')
          .catch(() => {})
        throw e
      } finally {
        level--
      }
    },
  }
  return db
}

let cachedPoolDb: Db | null = null

/** The shared pg pool as a `Db`. Transactions take a dedicated connection. */
export function poolDb(): Db {
  if (cachedPoolDb) return cachedPoolDb
  const db: Db = {
    async query(text, params = []) {
      const res = await getPool().query(text, params as unknown[])
      return res.rows
    },
    async one<T extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const rows = await db.query<T>(text, params)
      return rows[0] ?? null
    },
    transaction(fn) {
      return withTransaction((client) => fn(clientDb(client, { nested: true })))
    },
  }
  cachedPoolDb = db
  return db
}
