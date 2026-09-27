/**
 * GET /api/activity/export.csv — owner: IRDR-459. The same filters as GET /api/activity, every
 * matching row (executions and settings changes), newest first.
 */
import type { ActivityItem, SettingsAuditItem } from '#shared/api'
import { actionLabel } from '#shared/actions'
import { describeExecution } from '#shared/activity'
import { isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'
import { currentAppId } from '../../autonomy/app'
import {
  ACTIVITY_CSV_HEADER,
  csvCell,
  filterSeedActivity,
  parseActivityQuery,
  queryAllActivity,
  seedActivity,
} from '../../autonomy/activity'

type CsvRow = { time: string; cells: unknown[] }

function executionRow(r: ActivityItem): CsvRow {
  return {
    time: r.createdAt,
    cells: [
      r.createdAt,
      'action',
      actionLabel(r.type),
      describeExecution(r),
      `#${r.ticketDisplayNumber}`,
      r.executedBy,
      r.status,
      r.irreversible,
      r.error,
      r.externalRefs,
    ],
  }
}

function settingsRow(s: SettingsAuditItem): CsvRow {
  return {
    time: s.createdAt,
    cells: [
      s.createdAt,
      'settings',
      'Settings',
      s.summary,
      '',
      s.changedBy,
      'changed',
      false,
      '',
      '',
    ],
  }
}

export default defineEventHandler(async (event) => {
  const filters = parseActivityQuery(getQuery(event) as Record<string, unknown>)
  let rows: CsvRow[]
  if (!isDbConfigured()) {
    stubHeaders(event, 'IRDR-459')
    rows = filterSeedActivity(seedActivity(seedBundle()), { ...filters, cursor: null }).map(
      executionRow,
    )
  } else {
    const { items, settings } = await queryAllActivity(await currentAppId(), {
      ...filters,
      cursor: null,
    })
    rows = [...items.map(executionRow), ...settings.map(settingsRow)].sort((a, b) =>
      b.time.localeCompare(a.time),
    )
  }
  const lines = [ACTIVITY_CSV_HEADER.join(',')]
  for (const r of rows) lines.push(r.cells.map(csvCell).join(','))
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(
    event,
    'content-disposition',
    `attachment; filename="maelle-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
  )
  return lines.join('\n') + '\n'
})
