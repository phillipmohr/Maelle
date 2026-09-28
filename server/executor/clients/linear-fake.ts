/** In-memory Linear (team INS) for tests and the dev server. */
import type { ProviderError } from '../errors'
import type { LinearCommentRef, LinearIssueRef, LinearWriteClient } from './linear'

export interface FakeLinearIssue extends LinearIssueRef {
  description: string
  label: 'Bug' | 'Feature' | null
  comments: LinearCommentRef[]
}

export interface FakeLinear extends LinearWriteClient {
  readonly state: { issues: Map<string, FakeLinearIssue>; nextNumber: number }
  readonly calls: { op: string; args: unknown[] }[]
  failNext(op: keyof LinearWriteClient, error: ProviderError): void
  /** Adds an existing issue, e.g. INS-198, so the action can link it. */
  addIssue(input: { identifier: string; title: string; description?: string }): FakeLinearIssue
  reset(): void
}

export function createFakeLinear(): FakeLinear {
  const state: FakeLinear['state'] = { issues: new Map(), nextNumber: 300 }
  const calls: FakeLinear['calls'] = []
  const failures = new Map<string, ProviderError>()
  let commentSeq = 0
  function record(op: string, args: unknown[]) {
    calls.push({ op, args })
    const f = failures.get(op)
    if (f) {
      failures.delete(op)
      throw f
    }
  }
  const ref = (i: FakeLinearIssue): LinearIssueRef => ({
    id: i.id,
    identifier: i.identifier,
    url: i.url,
    title: i.title,
  })
  function byIdOrIdentifier(key: string): FakeLinearIssue | undefined {
    return state.issues.get(key) ?? [...state.issues.values()].find((i) => i.id === key)
  }
  return {
    state,
    calls,
    failNext(op, error) {
      failures.set(op, error)
    },
    addIssue(input) {
      const issue: FakeLinearIssue = {
        id: `lin_${input.identifier.toLowerCase()}`,
        identifier: input.identifier,
        url: `https://linear.app/instaradar/issue/${input.identifier}`,
        title: input.title,
        description: input.description ?? '',
        label: null,
        comments: [],
      }
      state.issues.set(issue.identifier, issue)
      return issue
    },
    reset() {
      state.issues.clear()
      state.nextNumber = 300
      calls.length = 0
      failures.clear()
    },
    async getIssue(identifier) {
      record('getIssue', [identifier])
      const i = byIdOrIdentifier(identifier)
      return i ? ref(i) : null
    },
    async findIssueByMarker(marker) {
      record('findIssueByMarker', [marker])
      const i = [...state.issues.values()].find((x) => x.description.includes(marker))
      return i ? ref(i) : null
    },
    async createIssue(input) {
      record('createIssue', [input])
      const identifier = `INS-${state.nextNumber++}`
      const issue: FakeLinearIssue = {
        id: `lin_${identifier.toLowerCase()}`,
        identifier,
        url: `https://linear.app/instaradar/issue/${identifier}`,
        title: input.title,
        description: input.description,
        label: input.label,
        comments: [],
      }
      state.issues.set(identifier, issue)
      return ref(issue)
    },
    async listComments(issueId) {
      record('listComments', [issueId])
      return [...(byIdOrIdentifier(issueId)?.comments ?? [])]
    },
    async createComment(issueId, body) {
      record('createComment', [issueId, body])
      const issue = byIdOrIdentifier(issueId)
      if (!issue) throw new Error(`Fake Linear: no issue ${issueId}`)
      const c = { id: `cmt_fake${(++commentSeq).toString(36)}`, body }
      issue.comments.push(c)
      return c
    },
  }
}
