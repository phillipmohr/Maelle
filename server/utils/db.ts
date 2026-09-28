/**
 * Server-side Postgres access for Maelle's own database (SUPABASE_DB_URL, or POSTGRES_URL as set by
 * Vercel's Supabase integration: the pooler URL in production; a local Postgres in tests via
 * TEST_DATABASE_URL). Server code writes through this
 * helper so the same SQL runs in `pnpm test:db` against a plain Postgres; `useServiceDb()`
 * (supabase-js, service role) stays for Storage and Auth admin calls.
 *
 *   const rows = await dbQuery<{ id: string }>('select id from tickets where status = $1', ['new'])
 *   await withTransaction(async (tx) => { await tx.query(...); await tx.query(...) })
 */
import pg from 'pg'

let pool: pg.Pool | null = null

export function dbUrl(): string | undefined {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.TEST_DATABASE_URL ||
    undefined
  )
}

export function isDbConfigured(): boolean {
  return Boolean(dbUrl())
}

export function getPool(): pg.Pool {
  if (pool) return pool
  const url = dbUrl()
  if (!url) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not configured (SUPABASE_DB_URL).',
    })
  }
  pool = new pg.Pool({
    connectionString: url,
    // Serverless friendly: few connections, short idle life; the Supabase pooler does the rest.
    max: Number(process.env.DB_POOL_MAX || 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  pool.on('error', (err) => console.error('[db] pool error', err))
  return pool
}

export async function dbQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params)
  return res.rows
}

export async function dbOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await dbQuery<T>(text, params)
  return rows[0] ?? null
}

export async function withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Tests only: close the pool so vitest can exit. */
export async function closeDbForTests(): Promise<void> {
  await pool?.end()
  pool = null
}
