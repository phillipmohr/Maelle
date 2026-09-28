/**
 * The executor (IRDR-457): decision API + the 11 actions + idempotency + audit log.
 * `server/plugins/executor.ts` registers `createExecutorService()` as `services.executor`.
 */
export { createExecutorService, type MaelleExecutor } from './service'
export { createClientsFromEnv, createFakeClients } from './clients'
export { createFakeStore, createPgStore } from './store'
export { ExecutorError, PreconditionError, ProviderError, formatActionError } from './errors'
export { planApprove, ConfirmRequiredError } from './decision'
export { ACTION_HANDLERS, describeEffect } from './actions'
