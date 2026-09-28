/**
 * pnpm db:reset [--force] [--seed]
 * Truncates every public table (schema stays). Refuses non-local databases unless --force is given,
 * so production data is never touched by accident. With --seed it re-seeds afterwards.
 */
import { OWNER } from '../shared/config'
import { client, isLocalUrl, requireDbUrl, tableNames } from './lib/db'
import { seed } from './db-seed'

const url = requireDbUrl()
const force = process.argv.includes('--force')
const reseed = process.argv.includes('--seed')

if (!isLocalUrl(url) && !force) {
  console.error('Refusing to reset a non-local database. Pass --force if you really mean it.')
  process.exit(1)
}

const db = client(url)
await db.connect()
try {
  const tables = (await tableNames(db)).filter((t) => t !== 'allowed_users')
  if (tables.length > 0) {
    await db.query(
      `truncate table ${tables.map((t) => `public."${t}"`).join(', ')} restart identity cascade`,
    )
    console.log(`truncated ${tables.length} tables`)
  }
} finally {
  await db.end()
}

if (reseed) {
  await seed(url, { allowedUserEmail: OWNER.email })
  console.log('re-seeded')
}
