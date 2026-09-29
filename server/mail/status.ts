/** The mailbox status the inbox shows (IRDR-455): live fetch, history import, classification. */
import type { MailStatusResponse } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import type { Db } from '../jobs/db'
import { JobQueue } from '../jobs/queue'
import { backfillRows, toProgress } from './backfill'
import type { MailContext } from './context'
import { classifyProgress } from './history-classify'

export async function closedCaseCounts(db: Db): Promise<Partial<Record<CaseType, number>>> {
  const rows = await db.query<{ case_type: string | null; n: number }>(
    `select case_type, count(*)::int as n from public.tickets
     where status = 'closed' and case_type is not null group by case_type`,
  )
  const out: Partial<Record<CaseType, number>> = {}
  for (const r of rows) if (r.case_type) out[r.case_type as CaseType] = r.n
  return out
}

export async function mailStatus(ctx: MailContext): Promise<MailStatusResponse> {
  const { db, config } = ctx
  const queue = new JobQueue(db)
  const [cursor, folders, fetchActive, backfillPending, classifyActive, caseCounts] =
    await Promise.all([
      db.one<{ last_fetch_at: Date | null; last_result: Record<string, unknown> | null }>(
        'select last_fetch_at, last_result from public.mail_cursors where mailbox = $1',
        [config.mailbox],
      ),
      backfillRows(db, config.mailbox),
      queue.hasPendingOfType('fetch_mail'),
      queue.hasPendingOfType('backfill_mail'),
      queue.hasPendingOfType('classify_imported'),
      closedCaseCounts(db),
    ])
  const classify = await classifyProgress(db, {
    active: classifyActive,
    classifier: ctx.classifier,
  })
  return {
    provider: ctx.provider.kind,
    mailbox: config.mailbox,
    fetch: {
      lastAt: cursor?.last_fetch_at?.toISOString() ?? null,
      lastResult: cursor?.last_result ?? null,
      active: fetchActive,
    },
    backfill: {
      folders: folders.map(toProgress),
      active:
        backfillPending || folders.some((f) => f.status === 'queued' || f.status === 'running'),
    },
    classify,
    caseCounts,
  }
}
