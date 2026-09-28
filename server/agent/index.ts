/**
 * `createAgentService()` wires the real adapters from the environment (read credentials only) and
 * registers as `services.agent` (see server/plugins/agent.ts). Every dependency can be overridden,
 * which is how tests and evals run the same code with fakes.
 */
import type { AgentRunResult, AgentService, AgentTrigger } from '#shared/services'
import { dbQuery, isDbConfigured } from '../utils/db'
import { services as registry } from '../utils/services'
import { isSupabaseConfigured, useServiceDb } from '../utils/supabase'
import { createMemoryAttachmentStore, createSupabaseAttachmentStore } from './attachments/store'
import { agentRuntimeConfig } from './config'
import { createKnowledgeLoader } from './knowledge/loader'
import { createAnthropicModelClient } from './model/anthropic'
import { createUnavailableModelClient } from './model/types'
import { runAgent, type AgentDeps, type AgentRunDetail, type RunOptions } from './run'
import { createDbAgentStore } from './store/db'
import { createToolsFromEnv } from './tools'

export interface AgentServiceImpl extends AgentService {
  run(ticketId: string, trigger: AgentTrigger, opts?: RunOptions): Promise<AgentRunResult>
  runDetailed(ticketId: string, trigger: AgentTrigger, opts?: RunOptions): Promise<AgentRunDetail>
  readonly deps: AgentDeps
}

export function createAgentService(overrides: Partial<AgentDeps> = {}): AgentServiceImpl {
  const config = overrides.config ?? agentRuntimeConfig()
  const tools =
    overrides.tools ??
    createToolsFromEnv(config, {
      dbQuery: <T extends Record<string, unknown>>(text: string, params: unknown[]) =>
        dbQuery<T>(text, params),
    })
  const deps: AgentDeps = {
    config,
    tools,
    store: overrides.store ?? createDbAgentStore(),
    model:
      overrides.model ??
      (config.anthropicApiKey
        ? createAnthropicModelClient(config.anthropicApiKey)
        : createUnavailableModelClient()),
    knowledge:
      overrides.knowledge ??
      createKnowledgeLoader({ notion: tools.notion, ttlMs: config.knowledgeCacheTtlMs }),
    attachments:
      overrides.attachments ??
      (isSupabaseConfigured()
        ? createSupabaseAttachmentStore(useServiceDb())
        : createMemoryAttachmentStore()),
    services: overrides.services === undefined ? registry : overrides.services,
    now: overrides.now,
    log:
      overrides.log ??
      ((msg, data) => {
        if (process.env.NODE_ENV !== 'test') console.info(`[agent] ${msg}`, data ?? '')
      }),
  }
  const runDetailed = async (ticketId: string, trigger: AgentTrigger, opts?: RunOptions) => {
    if (deps.store.kind === 'db' && !isDbConfigured())
      return {
        runId: '',
        status: 'failed' as const,
        retryable: false,
        error: 'Database is not configured (SUPABASE_DB_URL)',
        durationMs: 0,
        progress: {},
      }
    return runAgent(deps, ticketId, trigger, opts)
  }
  return {
    deps,
    runDetailed,
    async run(ticketId, trigger, opts) {
      const r = await runDetailed(ticketId, trigger, opts)
      return {
        runId: r.runId,
        status: r.status,
        proposalId: r.proposalId,
        error: r.error,
        retryable: r.retryable,
      }
    },
  }
}

export type { AgentDeps, AgentRunDetail, RunOptions } from './run'
