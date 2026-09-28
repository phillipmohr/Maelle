/**
 * Linear write client (LINEAR_API_KEY or LINEAR_WRITE_API_KEY; scopes: create issues, create comments). Issues are
 * created in team InstaRadar (`LINEAR` in shared/config.ts). Every issue or
 * comment Maelle writes carries a marker line ("Maelle ticket #4820"), and `findIssueByMarker` /
 * `listComments` let the action check for it before writing, so a retry never duplicates.
 */
import { LinearClient, LinearError } from '@linear/sdk'
import { ProviderError, fromLinearError } from '../errors'

export interface LinearIssueRef {
  id: string
  identifier: string
  url: string
  title: string
}

export interface LinearCommentRef {
  id: string
  body: string
}

export interface LinearWriteClient {
  /** By identifier such as "INS-198". Null when it does not exist. */
  getIssue(identifier: string): Promise<LinearIssueRef | null>
  /** The team's issue whose description contains the marker, if any. */
  findIssueByMarker(marker: string): Promise<LinearIssueRef | null>
  createIssue(input: {
    title: string
    description: string
    label: 'Bug' | 'Feature'
  }): Promise<LinearIssueRef>
  listComments(issueId: string): Promise<LinearCommentRef[]>
  createComment(issueId: string, body: string): Promise<LinearCommentRef>
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ProviderError) throw err
    throw err instanceof LinearError
      ? fromLinearError(err)
      : new ProviderError('Linear', err instanceof Error ? err.message : String(err), {
          cause: err,
        })
  }
}

export function createLinearWriteClient(
  apiKey: string,
  opts: { teamId?: string; teamName?: string } = {},
): LinearWriteClient {
  const client = new LinearClient({ apiKey })
  let teamIdPromise: Promise<string> | null = null

  function teamId(): Promise<string> {
    if (!teamIdPromise) {
      teamIdPromise = (async () => {
        if (opts.teamId) return opts.teamId
        const name = opts.teamName || 'InstaRadar'
        const teams = await client.teams({ filter: { name: { eqIgnoreCase: name } }, first: 1 })
        const team = teams.nodes[0]
        if (!team) {
          throw new ProviderError('Linear', `Team "${name}" not found`, { code: 'team_not_found' })
        }
        return team.id
      })().catch((err) => {
        teamIdPromise = null
        throw err
      })
    }
    return teamIdPromise
  }

  async function labelId(name: 'Bug' | 'Feature', team: string): Promise<string | null> {
    const labels = await client.issueLabels({
      filter: {
        name: { eqIgnoreCase: name },
        or: [{ team: { id: { eq: team } } }, { team: { null: true } }],
      },
      first: 5,
    })
    // Prefer the team label over a workspace label.
    const nodes = labels.nodes
    for (const l of nodes) {
      if ((await l.team)?.id === team) return l.id
    }
    return nodes[0]?.id ?? null
  }

  return {
    getIssue: (identifier) =>
      call(async () => {
        try {
          const issue = await client.issue(identifier)
          return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title }
        } catch (err) {
          if (err instanceof LinearError && /not found|Entity not found/i.test(err.message))
            return null
          throw err
        }
      }),
    findIssueByMarker: (marker) =>
      call(async () => {
        const team = await teamId()
        const issues = await client.issues({
          filter: { team: { id: { eq: team } }, description: { contains: marker } },
          first: 5,
        })
        const issue = issues.nodes[0]
        return issue
          ? { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title }
          : null
      }),
    createIssue: (input) =>
      call(async () => {
        const team = await teamId()
        const label = await labelId(input.label, team)
        const payload = await client.createIssue({
          teamId: team,
          title: input.title,
          description: input.description,
          ...(label ? { labelIds: [label] } : {}),
        })
        const issue = await payload.issue
        if (!payload.success || !issue) {
          throw new ProviderError('Linear', 'Issue creation returned no issue', {
            code: 'create_failed',
          })
        }
        return { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title }
      }),
    listComments: (issueId) =>
      call(async () => {
        const issue = await client.issue(issueId)
        const comments = await issue.comments({ first: 50 })
        return comments.nodes.map((c) => ({ id: c.id, body: c.body }))
      }),
    createComment: (issueId, body) =>
      call(async () => {
        const payload = await client.createComment({ issueId, body })
        const comment = await payload.comment
        if (!payload.success || !comment) {
          throw new ProviderError('Linear', 'Comment creation returned no comment', {
            code: 'create_failed',
          })
        }
        return { id: comment.id, body: comment.body }
      }),
  }
}
