/**
 * pnpm test:db
 * Starts the local Postgres (or uses TEST_DATABASE_URL), creates a fresh database, applies the
 * Supabase shim and all migrations, seeds it, and runs the database tests (tests/db).
 */
import { spawnSync } from 'node:child_process'
import { client, migrate } from './lib/db'
import { seed } from './db-seed'
import { LOCAL_PG_URL, start } from './local-pg'

const DB_NAME = process.env.TEST_DB_NAME || 'maelle_test'

let baseUrl = process.env.TEST_DATABASE_URL
if (!baseUrl) baseUrl = start()

const admin = client(baseUrl)
await admin.connect()
await admin.query(`drop database if exists ${DB_NAME}`)
await admin.query(`create database ${DB_NAME}`)
await admin.end()

const u = new URL(baseUrl)
u.pathname = `/${DB_NAME}`
const testUrl = u.toString()

const db = client(testUrl)
await db.connect()
await migrate(db, { shim: true })
await db.end()
await seed(testUrl, { allowedUserEmail: 'test@maelle.local', log: () => {} })

console.log(`database ready at ${testUrl}`)
// One test file at a time: the files share this database, and two of them upserting the same
// mail_cursors row inside their rolled-back transactions deadlocked on CI when run in parallel.
const r = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'tests/db', '--no-file-parallelism', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: testUrl },
  },
)
if (baseUrl === LOCAL_PG_URL) {
  // leave the cluster running for repeated runs; `pnpm db:local stop` stops it
}
process.exit(r.status ?? 1)
