/**
 * Linear, read only: search team InstaRadar for an existing issue so a duplicate gets linked
 * instead of created. Constructed with LINEAR_READ_API_KEY only.
 */
import { LinearClient, type Issue } from '@linear/sdk'
import type { LinearIssueSummary, LinearReadClient } from '../types'
import type { FakeOptions } from './stripe'

const CLOSED_STATE_TYPES = new Set(['completed', 'canceled', 'cancelled'])

/** Words worth searching for: drop stop words and very short tokens. */
export function searchTerms(text: string, max = 6): string[] {
  const stop = new Set(
    'the a an and or but if then else when while of to in on at for with without from by about as into like through after over between out against during before under around among is are was were be been being have has had do does did can could should would may might will shall not no nor so than too very just also i me my we our you your he she it they them this that these those there here what which who whom whose why how all any both each few more most other some such only own same please thanks thank hi hello dear regards keep getting get got'.split(
      ' ',
    ),
  )
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9@._-]+/)) {
    const w = raw.replace(/^[._-]+|[._-]+$/g, '')
    if (w.length < 4 || stop.has(w) || /^\d+$/.test(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w)
}

export function createLinearReadClient(apiKey: string, teamId?: string): LinearReadClient {
  const client = new LinearClient({ apiKey })

  async function summarise(issue: Issue): Promise<LinearIssueSummary> {
    const [state, labels] = await Promise.all([
      Promise.resolve(issue.state).catch(() => undefined),
      issue.labels().catch(() => ({ nodes: [] as { name: string }[] })),
    ])
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
      state: state?.name ?? 'Unknown',
      stateType: state?.type ?? null,
      url: issue.url,
      labels: labels.nodes.map((l) => l.name),
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    }
  }

  return {
    configured: true,
    async searchIssues(query, opts) {
      const terms = searchTerms(query)
      if (terms.length === 0) return []
      const filter: Record<string, unknown> = {
        or: terms.flatMap((t) => [
          { title: { containsIgnoreCase: t } },
          { description: { containsIgnoreCase: t } },
        ]),
      }
      if (teamId) filter.team = { id: { eq: teamId } }
      if (!opts?.includeClosed) filter.state = { type: { nin: ['completed', 'canceled'] } }
      const res = await client.issues({ filter, first: 25 })
      const summaries = await Promise.all(res.nodes.map((n) => summarise(n)))
      // Rank by how many search terms the title contains.
      const score = (s: LinearIssueSummary) =>
        terms.filter((t) => s.title.toLowerCase().includes(t)).length * 2 +
        terms.filter((t) => (s.description ?? '').toLowerCase().includes(t)).length
      return summaries.sort((a, b) => score(b) - score(a)).slice(0, 8)
    },
    async getIssue(identifier) {
      try {
        const issue = await client.issue(identifier)
        return await summarise(issue)
      } catch {
        return null
      }
    },
  }
}

export function createFakeLinearReadClient(
  issues: LinearIssueSummary[] = [],
  opts: FakeOptions = {},
): LinearReadClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    configured: !opts.unconfigured,
    async searchIssues(query, o) {
      calls.push(`search:${query}`)
      if (opts.fail) throw new Error(opts.fail)
      const terms = searchTerms(query)
      return issues
        .filter((i) => o?.includeClosed || !CLOSED_STATE_TYPES.has(i.stateType ?? ''))
        .filter((i) => {
          const hay = `${i.title} ${i.description ?? ''}`.toLowerCase()
          return terms.some((t) => hay.includes(t))
        })
    },
    async getIssue(identifier) {
      calls.push(`get:${identifier}`)
      if (opts.fail) throw new Error(opts.fail)
      return issues.find((i) => i.identifier === identifier) ?? null
    },
  }
}
