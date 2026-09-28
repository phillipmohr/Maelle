/**
 * pnpm db:seed
 * Inserts the design's sample data (shared/seed) into SUPABASE_DB_URL. Idempotent: existing rows
 * (by primary key) are left alone, so it can run on top of real data without duplicating anything.
 */
import { OWNER } from '../shared/config'
import { client, requireDbUrl } from './lib/db'
import { buildSeed, SEED_TABLE_ORDER, type SeedBundle } from '../shared/seed/data'

const PRIMARY_KEYS: Record<keyof SeedBundle, string[]> = {
  apps: ['id'],
  allowed_users: ['email'],
  settings: ['app_id'],
  autonomy_modes: ['app_id', 'case_type'],
  action_locks: ['app_id', 'action_type'],
  tickets: ['id'],
  messages: ['id'],
  agent_runs: ['id'],
  proposals: ['id'],
  proposed_actions: ['id'],
  action_executions: ['id'],
  decisions: ['id'],
  release_notifications: ['id'],
  cancellation_reasons: ['id'],
}

const JSON_COLUMNS = new Set([
  'customer_context',
  'attachments',
  'progress',
  'candidate_cases',
  'research',
  'reply_draft',
  'knowledge_refs',
  'params',
  'result',
  'external_refs',
  'reply_diff',
  'action_changes',
])

export async function seed(
  url: string,
  opts: { now?: Date; allowedUserEmail?: string; log?: (s: string) => void } = {},
) {
  const log = opts.log ?? console.log
  const bundle = buildSeed(opts.now ?? new Date(), opts.allowedUserEmail)
  const db = client(url)
  await db.connect()
  try {
    await db.query('begin')
    // agent_runs.proposal_id points at proposals, which are inserted later; link them afterwards.
    const runProposalLinks: { id: string; proposalId: string }[] = []
    for (const table of SEED_TABLE_ORDER) {
      const rows = bundle[table]
      let inserted = 0
      for (const original of rows) {
        let row = original
        if (table === 'agent_runs' && row.proposal_id) {
          runProposalLinks.push({ id: row.id as string, proposalId: row.proposal_id as string })
          row = { ...row, proposal_id: null }
        }
        const cols = Object.keys(row)
        const vals = cols.map((c) => {
          const v = row[c]
          if (v === undefined) return null
          if (JSON_COLUMNS.has(c)) return v === null ? null : JSON.stringify(v)
          return v
        })
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        const conflict = PRIMARY_KEYS[table].join(', ')
        const res = await db.query(
          `insert into public.${table} (${cols.map((c) => `"${c}"`).join(', ')}) values (${placeholders}) on conflict (${conflict}) do nothing`,
          vals,
        )
        inserted += res.rowCount ?? 0
      }
      log(`${table}: ${inserted}/${rows.length} inserted`)
    }
    for (const link of runProposalLinks) {
      await db.query(
        'update public.agent_runs set proposal_id = $1 where id = $2 and proposal_id is null',
        [link.proposalId, link.id],
      )
    }
    // Keep the display number sequence ahead of the seeded numbers.
    await db.query(
      `select setval(pg_get_serial_sequence('public.tickets', 'display_number'), greatest((select coalesce(max(display_number), 4800) from public.tickets), 4800))`,
    )
    await db.query('commit')
  } catch (e) {
    await db.query('rollback')
    throw e
  } finally {
    await db.end()
  }
  return bundle
}

if (process.argv[1] && /db-seed\.(ts|js)$/.test(process.argv[1])) {
  const url = requireDbUrl()
  await seed(url, { allowedUserEmail: OWNER.email })
  console.log('seed complete')
}
