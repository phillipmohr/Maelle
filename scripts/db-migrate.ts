/**
 * pnpm db:migrate
 * Applies pending SQL migrations from supabase/migrations to SUPABASE_DB_URL and makes sure
 * OWNER.email (shared/config.ts) is on the allow-list. Pass --shim when the target is a plain Postgres
 * (tests), never for a real Supabase project.
 */
import { OWNER } from '../shared/config'
import { client, ensureAllowedUser, migrate, requireDbUrl } from './lib/db'

const url = requireDbUrl()
const shim = process.argv.includes('--shim')
const db = client(url)
await db.connect()
try {
  await migrate(db, { shim })
  await ensureAllowedUser(db, OWNER.email)
  console.log(`allow-listed ${OWNER.email}`)
} finally {
  await db.end()
}
