/**
 * Everything the mail pipeline needs in one object (IRDR-455), so tests can swap the database,
 * the provider, the storage, the clock and the notifier. The server uses one shared context per
 * process (the fake provider keeps its state between requests in dev).
 */
import type { NotifyFn } from '#shared/services'
import { poolDb, type Db } from '../jobs/db'
import { defaultLog } from '../jobs/runner'
import { services } from '../utils/services'
import { mailConfigFromEnv, type MailConfig } from './config'
import { classifierFromConfig, type HistoryClassifier } from './history-classify'
import { createMailProvider } from './provider'
import { createAttachmentStore } from './storage'
import type { AttachmentStore, MailProvider } from './types'

export interface MailContext {
  db: Db
  provider: MailProvider
  store: AttachmentStore
  config: MailConfig
  /** Classify-only model for imported history tickets; null without ANTHROPIC_API_KEY. */
  classifier: HistoryClassifier | null
  notify: NotifyFn
  now: () => Date
  log: (msg: string) => void
}

export function createMailContext(overrides: Partial<MailContext> = {}): MailContext {
  const config = overrides.config ?? mailConfigFromEnv()
  return {
    db: overrides.db ?? poolDb(),
    provider: overrides.provider ?? createMailProvider(config),
    store: overrides.store ?? createAttachmentStore(),
    config,
    classifier:
      overrides.classifier !== undefined ? overrides.classifier : classifierFromConfig(config),
    notify: overrides.notify ?? ((kind, payload) => services.notify(kind, payload)),
    now: overrides.now ?? (() => new Date()),
    log: overrides.log ?? defaultLog,
  }
}

const g = globalThis as unknown as { __maelleMailContext?: MailContext }

/** The process-wide context (created on first use from the environment). */
export function getMailContext(): MailContext {
  if (!g.__maelleMailContext) g.__maelleMailContext = createMailContext()
  return g.__maelleMailContext
}

export function setMailContext(ctx: MailContext | null): void {
  g.__maelleMailContext = ctx ?? undefined
}
