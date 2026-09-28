import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
export const SHIM_SQL = path.join(ROOT, 'supabase', 'tests', 'supabase-shim.sql')

export function requireDbUrl(): string {
  const url =
    process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.TEST_DATABASE_URL
  if (!url) {
    console.error(
      'Set SUPABASE_DB_URL (or POSTGRES_URL, a Postgres URL) in .env or the environment.',
    )
    process.exit(1)
  }
  return url
}

export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'db'].includes(u.hostname)
  } catch {
    return false
  }
}

export function client(url: string): pg.Client {
  return new pg.Client({ connectionString: url })
}

export async function listMigrations(): Promise<{ version: string; name: string; file: string }[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  return files.map((f) => {
    const m = /^(\d+)_(.+)\.sql$/.exec(f)
    return { version: m?.[1] ?? f, name: m?.[2] ?? f, file: path.join(MIGRATIONS_DIR, f) }
  })
}

/**
 * Applies pending migrations and records them in `supabase_migrations.schema_migrations`, the same
 * table the Supabase CLI uses, so `supabase db push` and this runner agree on what has been applied.
 */
export async function migrate(
  db: pg.Client,
  opts: { shim?: boolean; log?: (s: string) => void } = {},
) {
  const log = opts.log ?? console.log
  if (opts.shim) {
    await db.query(await readFile(SHIM_SQL, 'utf8'))
    log('applied supabase shim (plain Postgres)')
  }
  await db.query('create schema if not exists supabase_migrations')
  await db.query(`create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  )`)
  const applied = new Set(
    (
      await db.query<{ version: string }>(
        'select version from supabase_migrations.schema_migrations',
      )
    ).rows.map((r) => r.version),
  )
  let count = 0
  for (const m of await listMigrations()) {
    if (applied.has(m.version)) continue
    const sql = await readFile(m.file, 'utf8')
    await db.query('begin')
    try {
      await db.query(sql)
      await db.query(
        'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
        [m.version, m.name, [sql]],
      )
      await db.query('commit')
    } catch (e) {
      await db.query('rollback')
      throw new Error(`migration ${m.version}_${m.name} failed: ${(e as Error).message}`, {
        cause: e,
      })
    }
    log(`applied ${m.version}_${m.name}`)
    count++
  }
  if (count === 0) log('no pending migrations')
  return count
}

export async function ensureAllowedUser(db: pg.Client, email: string | undefined) {
  if (!email) return
  await db.query('insert into public.allowed_users (email) values ($1) on conflict do nothing', [
    email.toLowerCase(),
  ])
}

export async function tableNames(db: pg.Client): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )
  return r.rows.map((x) => x.table_name)
}
