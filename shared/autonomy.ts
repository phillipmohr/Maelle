/**
 * Autonomy rules (IRDR-459). Pure functions shared by the server (track record, evaluate, PUT
 * validation, audit trail) and the UI (labels, collapsing rows). No I/O in here.
 */
import { z } from 'zod'
import { ACTIONS, ACTION_TYPES, actionLabel, type ActionType } from './actions'
import { CASE_TYPE_KEYS, CASE_TYPES, caseShortLabel, type CaseType } from './case-types'
import type { AutonomyMode, CaseTrackRecord, DecisionKind, SettingsRow } from './api'

/** The track record looks at the last 30 decisions of a case type. */
export const TRACK_RECORD_WINDOW = 30
/** Fewer decisions than this: "Collecting". */
export const AUTO_MIN_TICKETS = 15
/** At least this share of decisions must be unchanged for "Ready for Auto". */
export const AUTO_MIN_UNCHANGED_RATIO = 0.9
/** Case types with fewer tickets collapse into one "N more case types" row. */
export const CASE_ROW_MIN_TICKETS = 5
export const UNDO_WINDOW_OPTIONS = [5, 10, 15] as const

export type TrackTick = CaseTrackRecord['ticks'][number]
export type RecommendationKind = CaseTrackRecord['recommendationKind']

/**
 * Which tick a decision leaves. Snoozing and marking a failed ticket done are not verdicts on the
 * proposal (the approve decision of the same ticket already counted), so they leave none.
 */
export function decisionTick(decision: DecisionKind): TrackTick | null {
  switch (decision) {
    case 'rejected':
    case 'handled_manually':
      return 'rejected'
    case 'approved_with_edits':
      return 'edited'
    case 'approved':
    case 'auto':
      return 'unchanged'
    default:
      return null
  }
}

export function caseHasIrreversibleActions(caseType: CaseType): boolean {
  return CASE_TYPES[caseType].defaultActions.some((a) => ACTIONS[a].irreversible)
}

/** "Sep 12" (with the year when it is not the current one). */
export function autoSinceLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

export interface RecommendationInput {
  caseType: CaseType
  total: number
  unchanged: number
  rejected: number
  mode: AutonomyMode
  autoSince: string | null
  undos: number
}

/**
 * The recommendation rules of the ticket, in the order of the design data:
 * on Auto, irreversible actions, rejections, collecting, ready, otherwise too many edits.
 */
export function recommendationFor(
  r: RecommendationInput,
  now: Date = new Date(),
): { text: string; kind: RecommendationKind } {
  if (r.mode === 'auto') {
    const since = r.autoSince ? autoSinceLabel(r.autoSince, now) : 'today'
    return {
      text: `On Auto since ${since} · ${r.undos} undo${r.undos === 1 ? '' : 's'}`,
      kind: 'on_auto',
    }
  }
  if (caseHasIrreversibleActions(r.caseType)) {
    return { text: 'Keep asking · irreversible actions', kind: 'keep_asking' }
  }
  if (r.rejected > 0) {
    return { text: `Keep asking · ${r.rejected} rejected`, kind: 'keep_asking' }
  }
  if (r.total < AUTO_MIN_TICKETS) {
    const more = AUTO_MIN_TICKETS - r.total
    return { text: `Collecting · ${more} more ticket${more === 1 ? '' : 's'}`, kind: 'collecting' }
  }
  if (r.unchanged / r.total >= AUTO_MIN_UNCHANGED_RATIO) {
    return { text: 'Ready for Auto', kind: 'ready' }
  }
  return { text: 'Keep asking · too many edits', kind: 'keep_asking' }
}

export interface TrackRecordInput {
  caseType: CaseType
  /** Any order; sorted by `decidedAt` here. Decisions without a tick are ignored. */
  decisions: { decision: DecisionKind; decidedAt: string }[]
  mode?: AutonomyMode
  autoSince?: string | null
  undos?: number
}

/** The row of the Autonomy table for one case type. */
export function buildTrackRecord(input: TrackRecordInput, now: Date = new Date()): CaseTrackRecord {
  const ticks = [...input.decisions]
    .filter((d) => decisionTick(d.decision) !== null)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .slice(-TRACK_RECORD_WINDOW)
    .map((d) => decisionTick(d.decision)!)
  const total = ticks.length
  const unchanged = ticks.filter((t) => t === 'unchanged').length
  const edited = ticks.filter((t) => t === 'edited').length
  const rejected = ticks.filter((t) => t === 'rejected').length
  const mode: AutonomyMode = input.mode ?? 'always_ask'
  const autoSince = mode === 'auto' ? (input.autoSince ?? null) : null
  const undos = input.undos ?? 0
  const rec = recommendationFor(
    { caseType: input.caseType, total, unchanged, rejected, mode, autoSince, undos },
    now,
  )
  return {
    caseType: input.caseType,
    typicalActions: [...CASE_TYPES[input.caseType].defaultActions],
    ticks,
    total,
    unchanged,
    edited,
    rejected,
    recommendation: rec.text,
    recommendationKind: rec.kind,
    mode,
    autoSince,
    undos,
  }
}

/** "30 tickets · 28 unchanged · 2 edited · 0 rejected" */
export function trackRecordLine(
  c: Pick<CaseTrackRecord, 'total' | 'unchanged' | 'edited' | 'rejected'>,
): string {
  return `${c.total} ticket${c.total === 1 ? '' : 's'} · ${c.unchanged} unchanged · ${c.edited} edited · ${c.rejected} rejected`
}

/** Rows shown in the table; the rest collapses (case types with fewer than 5 tickets, not on Auto). */
export function isCollapsedCase(c: Pick<CaseTrackRecord, 'total' | 'mode'>): boolean {
  return c.total < CASE_ROW_MIN_TICKETS && c.mode !== 'auto'
}

// ---------------------------------------------------------------- settings

export type SettingKey = keyof Omit<SettingsRow, 'appId'>

export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  globalPause: 'Pause all',
  undoWindowMinutes: 'Undo window',
  digestTime: 'Daily digest',
  timezone: 'Timezone',
  followUpDays: 'Follow-up after',
  autoCloseDays: 'Auto-close after',
  refundDailyLimitCount: 'Refunds per day',
  refundDailyLimitAmountCents: 'Refund amount per day',
  notifyEmail: 'Notify email',
}

export function modeLabel(mode: AutonomyMode): string {
  return mode === 'auto' ? 'Auto' : 'Always ask'
}

/** Postgres returns `time` as "08:00:00"; the API and the UI use "08:00". */
export function normalizeDigestTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return value
  return `${m[1]!.padStart(2, '0')}:${m[2]}`
}

export function formatSettingValue(key: SettingKey, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'not set'
  switch (key) {
    case 'globalPause':
      return value ? 'on' : 'off'
    case 'undoWindowMinutes':
      return `${value} min`
    case 'followUpDays':
    case 'autoCloseDays':
      return `${value} day${Number(value) === 1 ? '' : 's'}`
    case 'refundDailyLimitAmountCents':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
        Number(value) / 100,
      )
    case 'digestTime':
      return normalizeDigestTime(String(value))
    default:
      return String(value)
  }
}

export type SettingsChangeScope = 'setting' | 'mode' | 'lock'

/** One line for the audit trail and the activity log, e.g. "Cancellation only: Always ask → Auto". */
export function describeSettingsChange(
  scope: SettingsChangeScope,
  key: string,
  from: unknown,
  to: unknown,
): string {
  if (scope === 'mode') {
    const label = (CASE_TYPE_KEYS as readonly string[]).includes(key)
      ? caseShortLabel(key as CaseType)
      : key
    return `${label}: ${modeLabel((from as AutonomyMode) ?? 'always_ask')} → ${modeLabel(to as AutonomyMode)}`
  }
  if (scope === 'lock') {
    const label = (ACTION_TYPES as readonly string[]).includes(key)
      ? actionLabel(key as ActionType)
      : key
    return `${label}: ${to ? 'locked' : 'unlocked'} for Auto`
  }
  const k = key as SettingKey
  const label = SETTING_LABELS[k] ?? key
  if (k === 'globalPause') return `${label}: ${to ? 'on' : 'off'}`
  return `${label}: ${formatSettingValue(k, from)} → ${formatSettingValue(k, to)}`
}

// ---------------------------------------------------------------- PUT /api/autonomy validation

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const AutonomyModeSchema = z.enum(['always_ask', 'auto'])

export const SettingsPatchSchema = z
  .object({
    globalPause: z.boolean().optional(),
    undoWindowMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
    digestTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
      .optional(),
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, 'Unknown timezone').optional(),
    followUpDays: z.number().int().min(1).max(60).optional(),
    autoCloseDays: z.number().int().min(1).max(90).optional(),
    refundDailyLimitCount: z.number().int().min(0).max(1000).optional(),
    refundDailyLimitAmountCents: z.number().int().min(0).max(100_000_000).optional(),
    notifyEmail: z.email().nullable().optional(),
  })
  .strict()

export const AutonomyUpdateSchema = z
  .object({
    modes: z
      .partialRecord(z.enum(CASE_TYPE_KEYS), AutonomyModeSchema)
      .refine((m) => m.unclear !== 'auto', { message: 'Unclear cases can never run on Auto' })
      .optional(),
    locks: z
      .partialRecord(z.enum(ACTION_TYPES), z.boolean())
      .refine((l) => Object.keys(l).every((k) => ACTIONS[k as ActionType].lockable), {
        message: 'Only lockable actions can be locked',
      })
      .optional(),
    settings: SettingsPatchSchema.optional(),
  })
  .strict()
  .refine((u) => u.modes || u.locks || u.settings, { message: 'Nothing to change' })

export type AutonomyUpdate = z.infer<typeof AutonomyUpdateSchema>
