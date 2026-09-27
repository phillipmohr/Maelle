/**
 * pnpm db:migrate
 * Applies pending SQL migrations from supabase/migrations to SUPABASE_DB_URL and makes sure
 * ALLOWED_USER_EMAIL is on the allow-list. Pass --shim when the target is a plain Postgres
 * (tests), never for a real Supabase project.
 */
import { client, ensureAllowedUser, migrate, requireDbUrl } from './lib/db'

const url = requireDbUrl()
const shim = process.argv.includes('--shim')
const db = client(url)
await db.connect()
try {
  await migrate(db, { shim })
  await ensureAllowedUser(db, process.env.ALLOWED_USER_EMAIL)
  if (process.env.ALLOWED_USER_EMAIL) console.log(`allow-listed ${process.env.ALLOWED_USER_EMAIL}`)
} finally {
  await db.end()
}
