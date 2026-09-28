/**
 * The bundle of read clients the agent researches with. `createToolsFromEnv()` builds a real
 * adapter only when its READ credential is set and an "unconfigured" client otherwise (which
 * reports `configured: false`, so the source is marked `skipped` with a research warning).
 * `createFakeTools()` wires fixture data for tests, evals and the dev server.
 */
import { agentRuntimeConfig, type AgentRuntimeConfig } from '../config'
import type {
  InstaradarReadClient,
  LinearIssueSummary,
  LinearReadClient,
  LogLine,
  NotionReadClient,
  NotionRow,
  StripeReadClient,
  VercelLogsClient,
} from '../types'
import { createInstaradarReadClient, createFakeInstaradarReadClient } from './instaradar'
import type { FakeInstaradarData } from './instaradar'
import { createFakeLinearReadClient, createLinearReadClient } from './linear'
import { createFakeNotionReadClient, createNotionReadClient } from './notion'
import { createFakeStripeReadClient, createStripeReadClient } from './stripe'
import type { FakeOptions, FakeStripeData } from './stripe'
import {
  createFakeVercelLogsClient,
  createLogDrainLogsClient,
  createVercelApiLogsClient,
} from './vercel'

export interface AgentTools {
  stripe: StripeReadClient
  instaradar: InstaradarReadClient
  vercel: VercelLogsClient
  linear: LinearReadClient
  notion: NotionReadClient
}

function unconfigured<T extends { configured: boolean }>(name: string, methods: string[]): T {
  const obj: Record<string, unknown> = { configured: false }
  for (const m of methods)
    obj[m] = async () => {
      throw new Error(`${name} is not configured`)
    }
  return obj as T
}

export function createToolsFromEnv(
  config: AgentRuntimeConfig = agentRuntimeConfig(),
  deps: {
    dbQuery?: <T extends Record<string, unknown>>(text: string, params: unknown[]) => Promise<T[]>
    /** Read the `vercel_logs` drain table instead of the Vercel API (needs `dbQuery`). */
    vercelLogsFromDrain?: boolean
  } = {},
): AgentTools {
  const stripe = config.stripeReadKey
    ? createStripeReadClient(config.stripeReadKey)
    : unconfigured<StripeReadClient>('Stripe', [
        'findCustomersByEmail',
        'searchCustomers',
        'getCustomer',
        'listSubscriptions',
        'listInvoices',
        'listCharges',
        'listRefunds',
        'listDisputes',
        'listEvents',
        'retrieve',
      ])
  const instaradar = config.instaradarDbReadUrl
    ? createInstaradarReadClient(config.instaradarDbReadUrl)
    : unconfigured<InstaradarReadClient>('InstaRadar database', [
        'findUserByEmail',
        'listTrackedProfiles',
        'listSignIns',
        'listScans',
        'listAlerts',
        'lookupProfile',
        'select',
      ])
  // The log drain adapter (`createLogDrainLogsClient`, table `vercel_logs`) is available when the
  // API window turns out to be too short; pass `deps.dbQuery` and switch here.
  let vercel: VercelLogsClient
  if (config.vercelApiToken) {
    vercel = createVercelApiLogsClient({
      token: config.vercelApiToken,
      teamSlug: config.vercelTeamSlug,
      project: config.vercelProject,
    })
  } else if (deps.dbQuery && deps.vercelLogsFromDrain) {
    vercel = createLogDrainLogsClient(deps.dbQuery)
  } else {
    vercel = unconfigured<VercelLogsClient>('Vercel logs', ['search'])
  }
  const linear = config.linearReadApiKey
    ? createLinearReadClient(config.linearReadApiKey, config.linearTeamId || undefined)
    : unconfigured<LinearReadClient>('Linear', ['searchIssues', 'getIssue'])
  const notion = config.notionReadToken
    ? createNotionReadClient(config.notionReadToken)
    : unconfigured<NotionReadClient>('Notion', ['queryDataSource', 'getPageText'])
  return { stripe, instaradar, vercel, linear, notion }
}

export interface FakeToolsData {
  stripe?: FakeStripeData
  instaradar?: FakeInstaradarData
  vercelLogs?: LogLine[]
  linearIssues?: LinearIssueSummary[]
  notion?: { dataSources?: Record<string, NotionRow[]>; pages?: Record<string, string> }
}

export interface FakeToolsOptions {
  stripe?: FakeOptions
  instaradar?: FakeOptions
  vercel?: FakeOptions
  linear?: FakeOptions
  notion?: FakeOptions
}

export function createFakeTools(data: FakeToolsData = {}, opts: FakeToolsOptions = {}) {
  return {
    stripe: createFakeStripeReadClient(data.stripe, opts.stripe),
    instaradar: createFakeInstaradarReadClient(data.instaradar, opts.instaradar),
    vercel: createFakeVercelLogsClient(data.vercelLogs, opts.vercel),
    linear: createFakeLinearReadClient(data.linearIssues, opts.linear),
    notion: createFakeNotionReadClient(data.notion, opts.notion),
  } satisfies AgentTools
}

export type FakeTools = ReturnType<typeof createFakeTools>
