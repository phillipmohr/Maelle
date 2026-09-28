/**
 * Vercel runtime logs of the InstaRadar project, read only.
 *
 * Two adapters:
 *
 * - `api`: the Runtime Logs REST endpoint,
 *   `GET https://api.vercel.com/v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs?teamId=…`
 *   (NDJSON, one log entry per line: level, message, timestampInMs, source, requestId, ...). The
 *   production deployment id comes from `GET /v6/deployments?projectId=…&target=production&limit=1`.
 *   The endpoint is meant for tailing, so it returns the recent window only and is filtered here by
 *   time, text, user id and profile handle. Good enough for "errors of the last days for this user".
 * - `drain`: a Vercel log drain (JSON format) posted into Maelle's own `vercel_logs` table (see the
 *   migration and the README) and queried with plain SQL. Use it when the API window is too short.
 *
 * Both are read only by construction; the token is only ever sent as a bearer header on GETs.
 */
import type { LogLine, LogQuery, VercelLogsClient } from '../types'
import type { FakeOptions } from './stripe'

const VERCEL_API = 'https://api.vercel.com'
const MAX_LINES = 400
const READ_BUDGET_MS = 12_000

function normaliseLevel(v: unknown): LogLine['level'] {
  const s = String(v ?? 'info').toLowerCase()
  if (s === 'error' || s === 'fatal') return 'error'
  if (s === 'warning' || s === 'warn') return 'warning'
  if (s === 'debug') return 'debug'
  return 'info'
}

export function matchesLogQuery(line: LogLine, q: LogQuery): boolean {
  if (line.at < q.since) return false
  if (q.until && line.at > q.until) return false
  if (q.level === 'error' && line.level !== 'error') return false
  if (q.level === 'warning' && line.level !== 'error' && line.level !== 'warning') return false
  const hay = `${line.message} ${line.source ?? ''} ${line.requestId ?? ''}`.toLowerCase()
  if (q.text && !hay.includes(q.text.toLowerCase())) return false
  if (q.userId && !hay.includes(q.userId.toLowerCase())) return false
  if (q.handle && !hay.includes(q.handle.replace(/^@/, '').toLowerCase())) return false
  return true
}

export function createVercelApiLogsClient(opts: {
  token: string
  projectId: string
  teamId?: string
  fetchImpl?: typeof fetch
}): VercelLogsClient {
  const fetchImpl = opts.fetchImpl ?? fetch
  const team = opts.teamId ? `teamId=${encodeURIComponent(opts.teamId)}` : ''
  const headers = { Authorization: `Bearer ${opts.token}` }

  async function productionDeploymentId(): Promise<string> {
    const url = `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(opts.projectId)}&target=production&limit=1${team ? `&${team}` : ''}`
    const res = await fetchImpl(url, { headers })
    if (!res.ok) throw new Error(`Vercel deployments ${res.status}`)
    const body = (await res.json()) as { deployments?: { uid?: string; id?: string }[] }
    const d = body.deployments?.[0]
    const id = d?.uid ?? d?.id
    if (!id) throw new Error('No production deployment found')
    return id
  }

  return {
    configured: true,
    async search(query) {
      const deploymentId = await productionDeploymentId()
      const url = `${VERCEL_API}/v1/projects/${encodeURIComponent(opts.projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs${team ? `?${team}` : ''}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), READ_BUDGET_MS)
      const lines: LogLine[] = []
      try {
        const res = await fetchImpl(url, { headers, signal: controller.signal })
        if (!res.ok || !res.body) throw new Error(`Vercel runtime logs ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (lines.length < MAX_LINES) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!raw) continue
            try {
              const j = JSON.parse(raw) as Record<string, unknown>
              const ts = Number(j.timestampInMs ?? j.timestamp ?? Date.now())
              const line: LogLine = {
                at: new Date(ts).toISOString(),
                level: normaliseLevel(j.level),
                source:
                  (j.source as string | undefined) ?? (j.function as string | undefined) ?? null,
                message: String(j.message ?? j.text ?? ''),
                requestId: (j.requestId as string | undefined) ?? null,
              }
              if (matchesLogQuery(line, query)) lines.push(line)
            } catch {
              // not JSON, ignore the line
            }
          }
        }
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError')) throw e
      } finally {
        clearTimeout(timer)
      }
      return lines.slice(0, query.limit ?? MAX_LINES)
    },
  }
}

/** Reads the `vercel_logs` table fed by a Vercel log drain (see README, "Vercel logs"). */
export function createLogDrainLogsClient(
  query: <T extends Record<string, unknown>>(text: string, params: unknown[]) => Promise<T[]>,
): VercelLogsClient {
  return {
    configured: true,
    async search(q) {
      const params: unknown[] = [q.since, q.until ?? new Date().toISOString()]
      const where = ['at >= $1', 'at <= $2']
      if (q.level === 'error') where.push(`level = 'error'`)
      if (q.level === 'warning') where.push(`level in ('error','warning')`)
      const needles = [q.text, q.userId, q.handle?.replace(/^@/, '')].filter(Boolean) as string[]
      for (const n of needles) {
        params.push(`%${n}%`)
        where.push(
          `(message ilike $${params.length} or coalesce(source,'') ilike $${params.length} or coalesce(request_id,'') ilike $${params.length})`,
        )
      }
      params.push(Math.min(q.limit ?? MAX_LINES, MAX_LINES))
      const rows = await query<{
        at: string
        level: string
        source: string | null
        message: string
        request_id: string | null
      }>(
        `select at, level, source, message, request_id from public.vercel_logs where ${where.join(' and ')} order by at desc limit $${params.length}`,
        params,
      )
      return rows.map((r) => ({
        at: new Date(r.at).toISOString(),
        level: normaliseLevel(r.level),
        source: r.source,
        message: r.message,
        requestId: r.request_id,
      }))
    },
  }
}

export function createFakeVercelLogsClient(
  lines: LogLine[] = [],
  opts: FakeOptions = {},
): VercelLogsClient & { calls: LogQuery[] } {
  const calls: LogQuery[] = []
  return {
    calls,
    configured: !opts.unconfigured,
    async search(query) {
      calls.push(query)
      if (opts.fail) throw new Error(opts.fail)
      return lines.filter((l) => matchesLogQuery(l, query)).slice(0, query.limit ?? MAX_LINES)
    },
  }
}
