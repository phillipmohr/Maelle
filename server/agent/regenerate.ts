/**
 * Bulk regenerate: the tickets whose reply draft is still unsent and can be drafted again. A draft
 * is unsent while the ticket needs a decision and its active proposal carries a reply; tickets that
 * already have an agent run queued or running are left out, so a double click never runs one twice.
 * Snoozed tickets are left alone: a run would wake them up (snoozed → researching → needs_decision).
 */
import { dbQuery } from '../utils/db'

export const REGENERABLE_DRAFTS_SQL = `
  select t.id
  from public.tickets t
  join public.proposals p on p.ticket_id = t.id and p.status = 'active'
  where t.status = 'needs_decision'
    and p.reply_draft is not null
    and not exists (
      select 1 from public.jobs j
      where j.type = 'agent_run'
        and j.status in ('queued', 'running')
        and j.payload->>'ticketId' = t.id::text
    )
  order by t.created_at asc, t.id asc`

export async function findRegenerableDrafts(): Promise<string[]> {
  const rows = await dbQuery<{ id: string }>(REGENERABLE_DRAFTS_SQL)
  return rows.map((r) => r.id)
}
