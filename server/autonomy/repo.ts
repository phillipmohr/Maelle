/**
 * Database access for the Autonomy page: settings, modes, locks, the track record (last 30
 * decisions per case type, joined to tickets.case_type), undo counts, and the PUT transaction that
 * writes one settings_audit row per change.
 */
import type pg from 'pg'
import type {
  AutonomyMode,
  AutonomyResponse,
  CaseTrackRecord,
  DecisionKind,
  SettingsAuditItem,
  SettingsRow,
} from '#shared/api'
import { ACTION_LIST, ACTIONS, type ActionType } from '#shared/actions'
import { TEMPLATE_CASE_TYPES, caseShortLabel, isCaseType, type CaseType } from '#shared/case-types'
import {
  TRACK_RECORD_WINDOW,
  buildTrackRecord,
  describeSettingsChange,
  normalizeDigestTime,
  type AutonomyUpdate,
  type SettingKey,
} from '#shared/autonomy'
import { dbOne, dbQuery, withTransaction } from '../utils/db'
import { iso } from './app'

type Row = Record<string, unknown>
type Queryable = Pick<pg.PoolClient, 'query'>

const SETTINGS_COLUMNS: Readonly<Record<SettingKey, string>> = {
  globalPause: 'global_pause',
  undoWindowMinutes: 'undo_window_minutes',
  digestTime: 'digest_time',
  timezone: 'timezone',
  followUpDays: 'follow_up_days',
  autoCloseDays: 'auto_close_days',
  refundDailyLimitCount: 'refund_daily_limit_count',
  refundDailyLimitAmountCents: 'refund_daily_limit_amount_cents',
  notifyEmail: 'notify_email',
}

export function settingsFromDb(r: Row): SettingsRow {
  return {
    appId: String(r.app_id),
    globalPause: Boolean(r.global_pause),
    undoWindowMinutes: Number(r.undo_window_minutes) as 5 | 10 | 15,
    digestTime: normalizeDigestTime(String(r.digest_time)),
    timezone: String(r.timezone),
    followUpDays: Number(r.follow_up_days),
    autoCloseDays: Number(r.auto_close_days),
    refundDailyLimitCount: Number(r.refund_daily_limit_count),
    refundDailyLimitAmountCents: Number(r.refund_daily_limit_amount_cents),
    notifyEmail: (r.notify_email as string | null) ?? null,
  }
}

export function settingsAuditFromDb(r: Row): SettingsAuditItem {
  return {
    id: String(r.id),
    createdAt: iso(r.created_at)!,
    changedBy: String(r.changed_by),
    scope: r.scope as SettingsAuditItem['scope'],
    key: String(r.key),
    oldValue: r.old_value ?? null,
    newValue: r.new_value ?? null,
    summary: String(r.summary ?? ''),
  }
}

async function one(q: Queryable, text: string, params: unknown[]): Promise<Row | null> {
  const res = await q.query(text, params)
  return (res.rows[0] as Row | undefined) ?? null
}

/** The settings row, created with the defaults when the app has none yet. */
export async function loadSettings(appId: string, q?: Queryable): Promise<SettingsRow> {
  const run = q ? (t: string, p: unknown[]) => one(q, t, p) : dbOne
  const row =
    (await run('select * from public.settings where app_id = $1', [appId])) ??
    (await run(
      'insert into public.settings (app_id) values ($1) on conflict (app_id) do nothing returning *',
      [appId],
    )) ??
    (await run('select * from public.settings where app_id = $1', [appId]))
  if (!row) throw new Error('settings row missing')
  return settingsFromDb(row as Row)
}

export interface ModeRow {
  mode: AutonomyMode
  changedAt: string
}

export async function loadModes(appId: string): Promise<Map<CaseType, ModeRow>> {
  const rows = await dbQuery<Row>(
    'select case_type, mode, changed_at from public.autonomy_modes where app_id = $1',
    [appId],
  )
  const map = new Map<CaseType, ModeRow>()
  for (const r of rows) {
    if (!isCaseType(r.case_type)) continue
    map.set(r.case_type, { mode: r.mode as AutonomyMode, changedAt: iso(r.changed_at)! })
  }
  return map
}

export async function loadLockRows(appId: string): Promise<Map<ActionType, boolean>> {
  const rows = await dbQuery<Row>(
    'select action_type, locked from public.action_locks where app_id = $1',
    [appId],
  )
  const map = new Map<ActionType, boolean>()
  for (const r of rows) {
    if (typeof r.action_type === 'string' && r.action_type in ACTIONS) {
      map.set(r.action_type as ActionType, Boolean(r.locked))
    }
  }
  return map
}

/** Every lockable action with its effective lock (row, or the registry default). */
export function effectiveLocks(rows: Map<ActionType, boolean>): AutonomyResponse['locks'] {
  return ACTION_LIST.filter((a) => a.lockable).map((a) => ({
    type: a.key,
    locked: rows.get(a.key) ?? a.lockedByDefault,
    lockable: a.lockable,
  }))
}

export async function loadTrackRecordDecisions(
  appId: string,
): Promise<Map<CaseType, { decision: DecisionKind; decidedAt: string }[]>> {
  const rows = await dbQuery<Row>(
    `with ranked as (
       select t.case_type, d.decision, d.decided_at,
              row_number() over (partition by t.case_type order by d.decided_at desc, d.id desc) as rn
       from public.decisions d
       join public.tickets t on t.id = d.ticket_id
       where t.app_id = $1 and t.case_type is not null
         and d.decision in ('approved','approved_with_edits','rejected','handled_manually','auto')
     )
     select case_type, decision, decided_at from ranked where rn <= $2 order by decided_at asc`,
    [appId, TRACK_RECORD_WINDOW],
  )
  const map = new Map<CaseType, { decision: DecisionKind; decidedAt: string }[]>()
  for (const r of rows) {
    if (!isCaseType(r.case_type)) continue
    const list = map.get(r.case_type) ?? []
    list.push({ decision: r.decision as DecisionKind, decidedAt: iso(r.decided_at)! })
    map.set(r.case_type, list)
  }
  return map
}

/** Tickets of a case type whose Auto execution was undone inside the undo window, since the case went on Auto. */
export async function loadUndoCounts(appId: string): Promise<Map<CaseType, number>> {
  const rows = await dbQuery<Row>(
    `select t.case_type, count(distinct e.ticket_id)::int as undos
     from public.action_executions e
     join public.tickets t on t.id = e.ticket_id
     left join public.autonomy_modes m on m.app_id = t.app_id and m.case_type = t.case_type
     where t.app_id = $1 and t.case_type is not null
       and e.executed_by = 'auto' and e.status = 'cancelled'
       and (m.changed_at is null or e.created_at >= m.changed_at)
     group by t.case_type`,
    [appId],
  )
  const map = new Map<CaseType, number>()
  for (const r of rows) if (isCaseType(r.case_type)) map.set(r.case_type, Number(r.undos))
  return map
}

export function sortCases(cases: CaseTrackRecord[]): CaseTrackRecord[] {
  return [...cases].sort(
    (a, b) =>
      b.total - a.total ||
      Number(b.mode === 'auto') - Number(a.mode === 'auto') ||
      caseShortLabel(a.caseType).localeCompare(caseShortLabel(b.caseType)),
  )
}

/** GET /api/autonomy from the database. */
export async function buildAutonomyResponse(
  appId: string,
  now: Date = new Date(),
): Promise<AutonomyResponse> {
  const [settings, modes, lockRows, decisions, undos] = await Promise.all([
    loadSettings(appId),
    loadModes(appId),
    loadLockRows(appId),
    loadTrackRecordDecisions(appId),
    loadUndoCounts(appId),
  ])
  const cases = sortCases(
    TEMPLATE_CASE_TYPES.map((caseType) => {
      const mode = modes.get(caseType)
      return buildTrackRecord(
        {
          caseType,
          decisions: decisions.get(caseType) ?? [],
          mode: mode?.mode ?? 'always_ask',
          autoSince: mode?.changedAt ?? null,
          undos: undos.get(caseType) ?? 0,
        },
        now,
      )
    }),
  )
  const onAutoCount = cases.filter((c) => c.mode === 'auto').length
  return {
    settings,
    cases,
    locks: effectiveLocks(lockRows),
    onAutoCount,
    alwaysAskCount: cases.length - onAutoCount,
  }
}

// ---------------------------------------------------------------- PUT /api/autonomy

interface PendingChange {
  scope: SettingsAuditItem['scope']
  key: string
  oldValue: unknown
  newValue: unknown
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Applies modes, locks and settings in one transaction and records one settings_audit row per
 * actual change (unchanged values are skipped). Returns the recorded changes.
 */
export async function applyAutonomyUpdate(
  appId: string,
  update: AutonomyUpdate,
  changedBy: string,
): Promise<SettingsAuditItem[]> {
  return withTransaction(async (tx) => {
    const changes: PendingChange[] = []

    if (update.settings) {
      const current = await loadSettings(appId, tx)
      await tx.query('select 1 from public.settings where app_id = $1 for update', [appId])
      const sets: string[] = []
      const values: unknown[] = [appId]
      for (const [k, value] of Object.entries(update.settings) as [SettingKey, unknown][]) {
        if (value === undefined || same(current[k], value)) continue
        values.push(value)
        sets.push(`${SETTINGS_COLUMNS[k]} = $${values.length}`)
        changes.push({ scope: 'setting', key: k, oldValue: current[k], newValue: value })
      }
      if (sets.length > 0) {
        await tx.query(`update public.settings set ${sets.join(', ')} where app_id = $1`, values)
      }
    }

    if (update.modes) {
      for (const [caseType, mode] of Object.entries(update.modes) as [CaseType, AutonomyMode][]) {
        if (!mode) continue
        const row = await one(
          tx,
          'select mode from public.autonomy_modes where app_id = $1 and case_type = $2 for update',
          [appId, caseType],
        )
        const currentMode = (row?.mode as AutonomyMode | undefined) ?? 'always_ask'
        if (currentMode === mode) continue
        await tx.query(
          `insert into public.autonomy_modes (app_id, case_type, mode, changed_at) values ($1, $2, $3, now())
           on conflict (app_id, case_type) do update set mode = excluded.mode, changed_at = now()`,
          [appId, caseType, mode],
        )
        changes.push({ scope: 'mode', key: caseType, oldValue: currentMode, newValue: mode })
      }
    }

    if (update.locks) {
      for (const [actionType, locked] of Object.entries(update.locks) as [ActionType, boolean][]) {
        if (locked === undefined) continue
        const row = await one(
          tx,
          'select locked from public.action_locks where app_id = $1 and action_type = $2 for update',
          [appId, actionType],
        )
        const current = row ? Boolean(row.locked) : ACTIONS[actionType].lockedByDefault
        if (current === locked) continue
        await tx.query(
          `insert into public.action_locks (app_id, action_type, locked, changed_at) values ($1, $2, $3, now())
           on conflict (app_id, action_type) do update set locked = excluded.locked, changed_at = now()`,
          [appId, actionType, locked],
        )
        changes.push({ scope: 'lock', key: actionType, oldValue: current, newValue: locked })
      }
    }

    const recorded: SettingsAuditItem[] = []
    for (const c of changes) {
      const summary = describeSettingsChange(c.scope, c.key, c.oldValue, c.newValue)
      const row = await one(
        tx,
        `insert into public.settings_audit (app_id, changed_by, scope, key, old_value, new_value, summary)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [
          appId,
          changedBy,
          c.scope,
          c.key,
          JSON.stringify(c.oldValue ?? null),
          JSON.stringify(c.newValue ?? null),
          summary,
        ],
      )
      if (row) recorded.push(settingsAuditFromDb(row))
    }
    return recorded
  })
}

/** Settings changes in a time range, newest first (for the activity log and the CSV export). */
export async function loadSettingsAudit(
  appId: string,
  range: { before?: string | null; from?: string | null; to?: string | null },
  limit = 200,
): Promise<SettingsAuditItem[]> {
  const rows = await dbQuery<Row>(
    `select * from public.settings_audit
     where app_id = $1
       and ($2::timestamptz is null or created_at < $2)
       and ($3::timestamptz is null or created_at >= $3)
       and ($4::timestamptz is null or created_at <= $4)
     order by created_at desc, id desc
     limit $5`,
    [appId, range.before ?? null, range.from ?? null, range.to ?? null, limit],
  )
  return rows.map(settingsAuditFromDb)
}
