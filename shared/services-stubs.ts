/**
 * Stub implementations of the service interfaces, so every ticket can code and test against them
 * before the owner ships. Stubs never touch external systems.
 */
import type {
  AgentService,
  AutonomyService,
  ExecutorService,
  JobHandle,
  JobHandler,
  JobPayloads,
  JobType,
  JobsService,
  MailService,
  NotifyFn,
  Services,
} from './services'

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (stub). The owning ticket registers the real service.`)
    this.name = 'NotImplementedError'
  }
}

function fakeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function createStubJobs(log: (msg: string) => void = () => {}): JobsService & {
  queue: { handle: JobHandle; payload: unknown }[]
} {
  const handlers = new Map<JobType, JobHandler>()
  const queue: { handle: JobHandle; payload: unknown }[] = []
  return {
    queue,
    async enqueue<T extends JobType>(
      type: T,
      payload: JobPayloads[T],
      runAt?: Date,
    ): Promise<JobHandle> {
      const handle: JobHandle = {
        id: fakeId('job'),
        type,
        runAt: (runAt ?? new Date()).toISOString(),
      }
      queue.push({ handle, payload })
      log(`[jobs:stub] enqueue ${type} ${JSON.stringify(payload)} at ${handle.runAt}`)
      return handle
    },
    registerHandler<T extends JobType>(type: T, handler: JobHandler<T>) {
      handlers.set(type, handler as JobHandler)
    },
    getHandler<T extends JobType>(type: T) {
      return handlers.get(type) as JobHandler<T> | undefined
    },
  }
}

export function createStubMail(log: (msg: string) => void = () => {}): MailService & {
  sent: { ticketId: string; to: string; subject: string }[]
  system: { to: string; subject: string }[]
} {
  const sent: { ticketId: string; to: string; subject: string }[] = []
  const system: { to: string; subject: string }[] = []
  return {
    sent,
    system,
    async sendReply(ticketId, draft) {
      sent.push({ ticketId, to: draft.to, subject: draft.subject })
      log(`[mail:stub] sendReply ticket=${ticketId} to=${draft.to} subject=${draft.subject}`)
      return {
        messageId: fakeId('msg'),
        providerMessageId: fakeId('prov'),
        rfcMessageId: `<${fakeId('stub')}@maelle.local>`,
      }
    },
    async sendSystemEmail(to, subject) {
      system.push({ to, subject })
      log(`[mail:stub] sendSystemEmail to=${to} subject=${subject}`)
    },
  }
}

export function createStubAgent(log: (msg: string) => void = () => {}): AgentService {
  return {
    async run(ticketId, trigger) {
      log(`[agent:stub] run ticket=${ticketId} trigger=${trigger}`)
      return { runId: fakeId('run'), status: 'failed', error: 'agent stub: no model call' }
    },
  }
}

export function createStubExecutor(): ExecutorService {
  const nope = (what: string) => {
    throw new NotImplementedError(`executor.${what}`)
  }
  return {
    approve: async () => nope('approve'),
    reject: async () => nope('reject'),
    manualSend: async () => nope('manualSend'),
    snooze: async () => nope('snooze'),
    unsnooze: async () => nope('unsnooze'),
    retry: async () => nope('retry'),
    markDone: async () => nope('markDone'),
    setCase: async () => nope('setCase'),
    undo: async () => nope('undo'),
    async runAuto() {
      return { ran: false, refused: 'executor stub: Auto is not available yet' }
    },
    async runDueScheduled() {
      return { ran: 0 }
    },
  }
}

export function createStubAutonomy(): AutonomyService {
  return {
    async evaluate() {
      return 'ask'
    },
  }
}

export function createStubNotify(log: (msg: string) => void = () => {}): NotifyFn & {
  calls: { kind: string; payload: unknown }[]
} {
  const calls: { kind: string; payload: unknown }[] = []
  const fn = (async (kind, payload) => {
    calls.push({ kind, payload })
    log(`[notify:stub] ${kind} ${JSON.stringify(payload)}`)
  }) as NotifyFn & { calls: typeof calls }
  fn.calls = calls
  return fn
}

export function createStubServices(log: (msg: string) => void = () => {}): Services {
  return {
    jobs: createStubJobs(log),
    mail: createStubMail(log),
    agent: createStubAgent(log),
    executor: createStubExecutor(),
    autonomy: createStubAutonomy(),
    notify: createStubNotify(log),
  }
}
