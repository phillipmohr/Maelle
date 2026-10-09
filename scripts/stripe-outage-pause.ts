/**
 * IRDR-479 (InstaRadar outage): pauses every Stripe subscription, voids every open invoice and stops
 * every auto-advancing draft. LIVE, no dry run, no confirmation prompt.
 *
 *   pnpm exec tsx scripts/stripe-outage-pause.ts
 *
 * Reads STRIPE_SECRET_KEY from the environment or .env. Run it with a test-mode key first. Writes
 * every action to .data/stripe-outage-pause/<runId>/actions.jsonl and the final report (including
 * each pause timestamp, which IRDR-480 needs) to summary.json in the same folder. Safe to re-run:
 * paused subscriptions and non-open invoices are skipped. Exits 1 when anything is left billing.
 *
 * Resuming is manual and out of scope: POST /v1/subscriptions/:id/resume (see IRDR-479).
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Stripe from 'stripe'
import { ROOT } from './lib/db'
import {
  createStripeOutageClient,
  runOutagePause,
  type OutageLogEvent,
} from './lib/stripe-outage-pause'

const envFile = path.join(ROOT, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const apiKey = process.env.STRIPE_SECRET_KEY
if (!apiKey) {
  console.error('Set STRIPE_SECRET_KEY in .env or the environment.')
  process.exit(1)
}
const mode = /^(sk|rk)_live_/.test(apiKey) ? 'LIVE' : 'TEST'

const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z')
const outDir = path.join(ROOT, '.data', 'stripe-outage-pause', runId)
mkdirSync(outDir, { recursive: true })
const actionsFile = path.join(outDir, 'actions.jsonl')

const log = (event: OutageLogEvent) => {
  appendFileSync(actionsFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n')
  if (event.kind === 'inventory') {
    const summary = Array.isArray(event.data)
      ? event.data.length
      : JSON.stringify({ ...(event.data as object), subscriptions: undefined })
    console.log(`[inventory] ${event.label}: ${summary}`)
  } else {
    const status = event.ok ? 'ok' : 'FAILED'
    console.log(
      `[${event.step}] ${event.action} ${event.id} ${status}${event.detail ? `: ${event.detail}` : ''}`,
    )
  }
}

console.log(`Stripe ${mode} mode, run ${runId}, log ${path.relative(ROOT, outDir)}`)
const stripe = new Stripe(apiKey, {
  // Retries are safe: every write carries an idempotency key.
  maxNetworkRetries: 2,
  timeout: 30_000,
  appInfo: { name: 'Maelle outage pause (IRDR-479)' },
})
const report = await runOutagePause(createStripeOutageClient(stripe), { runId, log })
writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(report, null, 2) + '\n')

console.log('\nSubscriptions by status:', report.counts.subscriptionsByStatus)
console.log(
  `Migrated ${report.counts.migrated}, paused ${report.counts.paused}, voided ${report.counts.voided}, ` +
    `auto-advance disabled ${report.counts.autoAdvanceDisabled}, failures ${report.counts.failures}`,
)
for (const s of report.notPaused)
  console.log(`NOT PAUSED ${s.id} (${s.customer}, ${s.status}): ${s.reason}`)
for (const i of report.openInvoicesLeft) console.log(`OPEN INVOICE LEFT ${i.id} (${i.customer})`)
for (const i of report.autoAdvancingDraftsLeft)
  console.log(`AUTO-ADVANCING DRAFT LEFT ${i.id} (${i.customer})`)
for (const f of report.failures) console.log(`FAILED ${f.action} ${f.id}: ${f.error}`)
console.log(
  report.ok ? '\nDone: nothing is left billing.' : '\nNot clean: see above and summary.json.',
)
process.exit(report.ok ? 0 : 1)
