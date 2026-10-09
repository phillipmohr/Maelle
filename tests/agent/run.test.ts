/**
 * Behaviour of a whole run with the memory store: validation feedback and retries, the failure
 * path, partial source failure, two-stage enforcement, case override, translations, idempotency
 * and the autonomy hand-off.
 */
import { describe, expect, it } from 'vitest'
import type { ProposalInput } from '../../shared/proposal'
import { createAgentService } from '../../server/agent'
import { createScriptedModelClient, type ScriptedTurn } from '../../server/agent/model/scripted'
import { runAgent } from '../../server/agent/run'
import { SUBMIT_TOOL } from '../../server/agent/tools/definitions'
import { CASE_1_CANCELLATION, CASE_2_REFUND, CASE_3_CHARGEBACK } from '../../evals/fixtures/cases'
import type { Fixture } from '../../evals/fixtures/types'
import { harnessDeps, runFixture, seedStore } from '../../evals/harness'

const submit = (proposal: unknown): ScriptedTurn => ({
  toolCalls: [{ name: SUBMIT_TOOL, input: proposal }],
})
const good = CASE_1_CANCELLATION.scripted.proposal

async function run(
  fixture: Fixture,
  turns: ScriptedTurn[],
  extra: Parameters<typeof harnessDeps>[2] = {},
) {
  const model = createScriptedModelClient(turns)
  const { store, ticketId } = seedStore(fixture)
  const deps = harnessDeps(fixture, store, { ...extra, model })
  const result = await runAgent(deps, ticketId, fixture.trigger)
  return { model, store, ticketId, result, deps }
}

describe('validation feedback', () => {
  it('feeds the issues back and accepts the corrected proposal', async () => {
    const bad: ProposalInput = {
      ...good,
      reply: { ...good.reply!, body: 'Hi Tom — I cancelled it.' },
    }
    const { model, store, ticketId, result } = await run(CASE_1_CANCELLATION, [
      submit(bad),
      submit(good),
    ])
    expect(result.status).toBe('succeeded')
    const feedback = model.toolResults[1]!.find((r) => r.is_error)
    expect(feedback).toBeDefined()
    expect(String(feedback!.content)).toMatch(/em dash/)
    expect(String(feedback!.content)).toMatch(/attempt 1 of 3/)
    expect((await store.getTicket(ticketId))!.status).toBe('needs_decision')
    expect(store.runs[0]!.status).toBe('succeeded')
  })

  it('marks the run failed after three rejected submissions; the ticket shows needs_decision with the error', async () => {
    const bad = {
      ...good,
      confidence: 7,
      actions: [
        { type: 'send_reply', params: { to: 'tom.becker@web.de', cc: 'not-a-list' }, reason: 'x' },
      ],
    }
    const { store, ticketId, result } = await run(CASE_1_CANCELLATION, [
      submit(bad),
      submit(bad),
      submit(bad),
      submit(good),
    ])
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/rejected 3 times/)
    const ticket = (await store.getTicket(ticketId))!
    expect(ticket.status).toBe('needs_decision')
    expect(ticket.customerContext).not.toBeNull() // the context panel is still filled
    expect(store.runs[0]).toMatchObject({ status: 'failed' })
    expect(store.runs[0]!.error).toMatch(/confidence/)
    expect(store.runs[0]!.error).toMatch(/actions\.0\.params\.cc/)
    expect(store.proposals).toHaveLength(0)
  })

  it('fails when the model keeps answering in plain text', async () => {
    const { result } = await run(CASE_1_CANCELLATION, [
      { text: 'Here is my analysis.' },
      { text: 'Still text.' },
      { text: 'Really.' },
    ])
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/without calling submit_proposal/)
  })

  it('fails on a refusal and continues after a truncated turn', async () => {
    const refused = await run(CASE_1_CANCELLATION, [{ text: '', stopReason: 'refusal' }])
    expect(refused.result.status).toBe('failed')
    expect(refused.result.error).toMatch(/refusal/)
    const truncated = await run(CASE_1_CANCELLATION, [
      { text: 'partial…', stopReason: 'max_tokens' },
      submit(good),
    ])
    expect(truncated.result.status).toBe('succeeded')
  })

  it('fails when the model never finishes within the iteration budget', async () => {
    const { result } = await run(
      CASE_1_CANCELLATION,
      Array.from({ length: 6 }, () => ({ toolCalls: [{ name: 'email_history', input: {} }] })),
      { config: { maxIterations: 4 } },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/within 4 steps/)
  })
})

describe('partial source failure', () => {
  it('still yields a proposal, marks the source failed and adds a research warning', async () => {
    const fixture: Fixture = {
      ...CASE_1_CANCELLATION,
      toolOptions: { stripe: { fail: 'Stripe 503' }, vercel: { unconfigured: true } },
    }
    const r = await runFixture(fixture)
    expect(r.result.status).toBe('succeeded')
    expect(r.result.progress.stripe).toBe('failed')
    expect(r.result.progress.vercel).toBe('skipped')
    expect(r.proposal!.researchWarnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Stripe unavailable \(Stripe 503\)/),
        'Vercel logs not configured',
      ]),
    )
    expect(r.ticket.customerContext?.plan[0]).toEqual({ label: 'Plan', value: 'Pro Monthly' }) // from the InstaRadar database
  })

  it('a research tool failure during the loop becomes a tool error, not a crash', async () => {
    const fixture: Fixture = {
      ...CASE_1_CANCELLATION,
      toolOptions: { linear: { fail: 'Linear 500' } },
    }
    const model = createScriptedModelClient([
      { toolCalls: [{ name: 'linear_search', input: { query: 'unsubscribe' } }] },
      submit(good),
    ])
    const { store, ticketId } = seedStore(fixture)
    const result = await runAgent(harnessDeps(fixture, store, { model }), ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    expect(model.toolResults[1]![0]).toMatchObject({ is_error: true })
    expect(result.progress.linear).toBe('failed')
  })
})

describe('two-stage enforcement', () => {
  it('rejects a stage-2 submission without a customer confirmation and accepts the corrected stage 1', async () => {
    const stage1 = CASE_2_REFUND.scripted.proposal
    const premature: ProposalInput = {
      ...stage1,
      customerConfirmationNeeded: false,
      stage: 2,
      actions: stage1.actions!.map((a) => ({ ...a, stage: 'now' as const })),
    }
    const { model, store, ticketId, result } = await run(CASE_2_REFUND, [
      submit(premature),
      submit(stage1),
    ])
    expect(result.status).toBe('succeeded')
    const feedback = String(model.toolResults[1]!.find((r) => r.is_error)!.content)
    expect(feedback).toMatch(/customerConfirmationNeeded set to true by policy/)
    expect(feedback).toMatch(/after_confirmation/)
    const p = (await store.getLatestProposal(ticketId))!
    expect(p.stage).toBe(1)
    expect(p.customerConfirmationNeeded).toBe(true)
    expect(
      p.actions
        .filter((a) => a.type !== 'send_reply')
        .every((a) => a.stage === 'after_confirmation'),
    ).toBe(true)
    expect((await store.getTicket(ticketId))!.waitingFor).toBe('Customer confirmation')
  })
})

describe('case override', () => {
  it('insists on the case the user picked', async () => {
    const fixture: Fixture = { ...CASE_1_CANCELLATION, trigger: 'case_override' }
    const { store, ticketId } = seedStore(fixture)
    const ticket = (await store.getTicket(ticketId))!
    ticket.status = 'needs_decision'
    ticket.caseType = 'cancellation_reason_ask'
    const model = createScriptedModelClient([
      submit(good),
      submit({
        ...good,
        case: 'cancellation_reason_ask',
        reply: {
          ...good.reply!,
          template: 'Cancellation + reason ask',
          templateNotionPageId: null,
        },
      }),
    ])
    const result = await runAgent(harnessDeps(fixture, store, { model }), ticketId, 'case_override')
    expect(result.status).toBe('succeeded')
    expect(String(model.toolResults[1]![0]!.content)).toMatch(
      /the user chose "cancellation_reason_ask"/,
    )
    const p = (await store.getLatestProposal(ticketId))!
    expect(p.caseType).toBe('cancellation_reason_ask')
    expect(p.knowledgeRefs.map((k) => k.title)).toContain('Cancellation + reason ask')
    expect(p.reply?.templateNotionPageId).toBe('3e8c931f6ae58147b800e658bf20d6d7')
  })
})

describe('translations, recipient, attachment', () => {
  it('stores translations of non-English messages and fixes the recipient', async () => {
    const fixture: Fixture = {
      ...CASE_1_CANCELLATION,
      messages: [
        {
          direction: 'in',
          text: 'Bitte kündigen Sie mein Abo.',
          at: CASE_1_CANCELLATION.messages[0]!.at,
        },
      ],
    }
    const { store, ticketId } = seedStore(fixture)
    const messageId = store.messages[0]!.id
    const model = createScriptedModelClient([
      submit({
        ...good,
        reply: { ...good.reply!, to: 'wrong@example.com' },
        translations: [{ messageId, translation: 'Please cancel my subscription.' }],
      }),
    ])
    const result = await runAgent(harnessDeps(fixture, store, { model }), ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    expect(store.messages[0]!.translation).toBe('Please cancel my subscription.')
    const p = (await store.getLatestProposal(ticketId))!
    expect(p.reply?.to).toBe('tom.becker@web.de')
    expect(result.notes?.join(' ')).toMatch(/reply.to set to tom.becker@web.de/)
  })

  it('rejects translations for unknown message ids', async () => {
    const { model, result } = await run(CASE_1_CANCELLATION, [
      submit({ ...good, translations: [{ messageId: 'nope', translation: 'x' }] }),
      submit(good),
    ])
    expect(result.status).toBe('succeeded')
    expect(String(model.toolResults[1]![0]!.content)).toMatch(/unknown messageId "nope"/)
  })

  it('attaches the Stripe timeline to chargeback replies and keeps includeAttachments on', async () => {
    const r = await runFixture(CASE_3_CHARGEBACK)
    const attachments = r.proposal!.reply!.attachments
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({
      contentType: 'image/svg+xml',
      storagePath: expect.stringMatching(/^tickets\/.*stripe-timeline-rachel-kim\.svg$/),
    })
    expect(r.proposal!.actions.find((a) => a.type === 'send_reply')!.params).toMatchObject({
      includeAttachments: true,
    })
    expect(r.proposal!.policyWarnings).toEqual([])
    expect(r.ticket.tags).toEqual(expect.arrayContaining(['Long-term', 'Resubscribed']))
  })
})

describe('idempotency and state', () => {
  it('reuses a succeeded run for the same job id', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const deps = harnessDeps(CASE_1_CANCELLATION, store)
    const first = await runAgent(deps, ticketId, 'new_ticket', { jobId: 'job-1' })
    expect(first.status).toBe('succeeded')
    const ticket = (await store.getTicket(ticketId))!
    ticket.status = 'needs_decision'
    const second = await runAgent(harnessDeps(CASE_1_CANCELLATION, store), ticketId, 'new_ticket', {
      jobId: 'job-1',
    })
    expect(second).toMatchObject({
      runId: first.runId,
      status: 'succeeded',
      proposalId: first.proposalId,
    })
    expect(store.proposals).toHaveLength(1)
    expect(store.runs).toHaveLength(1)
  })

  it('a retried job after a failure reuses the run row and bumps the attempt', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const failing = createScriptedModelClient([{ text: 'no' }, { text: 'no' }, { text: 'no' }])
    const first = await runAgent(
      harnessDeps(CASE_1_CANCELLATION, store, { model: failing }),
      ticketId,
      'new_ticket',
      { jobId: 'job-2' },
    )
    expect(first.status).toBe('failed')
    const second = await runAgent(harnessDeps(CASE_1_CANCELLATION, store), ticketId, 'new_ticket', {
      jobId: 'job-2',
    })
    expect(second.status).toBe('succeeded')
    expect(second.runId).toBe(first.runId)
    expect(store.runs[0]!.attempt).toBe(2)
  })

  it('refuses to run in a state the machine does not allow and leaves the ticket alone', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const ticket = (await store.getTicket(ticketId))!
    ticket.status = 'executing'
    const result = await runAgent(harnessDeps(CASE_1_CANCELLATION, store), ticketId, 'rerun')
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/while the ticket is executing/)
    expect((await store.getTicket(ticketId))!.status).toBe('executing')
    expect(store.runs[0]!.status).toBe('failed')
  })

  it('runs from waiting_on_customer, snoozed and closed as well', async () => {
    for (const status of ['waiting_on_customer', 'snoozed', 'closed'] as const) {
      const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
      const ticket = (await store.getTicket(ticketId))!
      ticket.status = status
      const result = await runAgent(
        harnessDeps(CASE_1_CANCELLATION, store),
        ticketId,
        'customer_reply',
      )
      expect(result.status, status).toBe('succeeded')
      expect((await store.getTicket(ticketId))!.status).toBe('needs_decision')
    }
  })

  it('reports an unknown ticket', async () => {
    const { store } = seedStore(CASE_1_CANCELLATION)
    const result = await runAgent(harnessDeps(CASE_1_CANCELLATION, store), 'missing', 'new_ticket')
    expect(result).toMatchObject({ status: 'failed', error: expect.stringMatching(/not found/) })
  })
})

describe('autonomy hand-off', () => {
  it('calls autonomy.evaluate and runs the executor only on auto', async () => {
    const calls: string[] = []
    const services = (verdict: 'auto' | 'ask') => ({
      autonomy: { evaluate: async (id: string) => (calls.push(`evaluate:${id}`), verdict) },
      executor: {
        runAuto: async (id: string) => (calls.push(`runAuto:${id}`), { ran: true }),
      } as never,
    })
    const a = await runFixture(CASE_1_CANCELLATION, { services: services('auto') })
    expect(a.result.status).toBe('succeeded')
    expect(calls).toEqual([`evaluate:${a.ticketId}`, `runAuto:${a.ticketId}`])
    calls.length = 0
    const b = await runFixture(CASE_1_CANCELLATION, { services: services('ask') })
    expect(calls).toEqual([`evaluate:${b.ticketId}`])
  })

  it('a failing hand-off does not fail the run', async () => {
    const services = {
      autonomy: {
        evaluate: async () => {
          throw new Error('autonomy down')
        },
      },
      executor: { runAuto: async () => ({ ran: false }) } as never,
    }
    const r = await runFixture(CASE_1_CANCELLATION, { services })
    expect(r.result.status).toBe('succeeded')
  })
})

describe('createAgentService', () => {
  it('wires overrides and implements the AgentService contract', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const deps = harnessDeps(CASE_1_CANCELLATION, store)
    const service = createAgentService({ ...deps, services: null })
    const result = await service.run(ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    expect(result.proposalId).toBeDefined()
    expect(service.deps.model.kind).toBe('scripted')
  })

  it('fails fast without a database when the Postgres store is used', async () => {
    const saved = { db: process.env.SUPABASE_DB_URL, test: process.env.TEST_DATABASE_URL }
    delete process.env.SUPABASE_DB_URL
    delete process.env.TEST_DATABASE_URL
    try {
      const service = createAgentService({ services: null })
      expect(service.deps.model.kind).toBe(
        process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'unavailable',
      )
      const result = await service.run('t', 'new_ticket')
      expect(result).toMatchObject({
        status: 'failed',
        error: expect.stringMatching(/Database is not configured/),
      })
    } finally {
      if (saved.db) process.env.SUPABASE_DB_URL = saved.db
      if (saved.test) process.env.TEST_DATABASE_URL = saved.test
    }
  })
})

describe('hand-off and the switched-off Knowledge Base (IRDR-477)', () => {
  it('a hand-off drops the reply and the actions the model drafted anyway', async () => {
    const { store, ticketId, result } = await run(CASE_1_CANCELLATION, [
      submit({
        ...good,
        summaryLine: 'Hand over: asks whether story viewers are shown.',
        handoff: { reason: 'Asks whether story viewers are shown; no instruction covers it.' },
      }),
    ])
    expect(result.status).toBe('succeeded')
    expect(result.notes?.join(' ')).toMatch(/reply removed: a hand-off/)
    const p = (await store.getLatestProposal(ticketId))!
    expect(p.handoffReason).toMatch(/story viewers/)
    expect(p.metaLine).toBe('Hand-off · nothing drafted')
    expect(p.reply).toBeNull()
    expect(p.actions).toEqual([])
    expect(p.noKnowledgeFound).toBe(false)
    expect((await store.getTicket(ticketId))!.status).toBe('needs_decision')
  })

  it('a routine proposal has no hand-off and no knowledge-base flag while the KB is off', async () => {
    const { model, store, ticketId } = await run(CASE_1_CANCELLATION, [submit(good)])
    const p = (await store.getLatestProposal(ticketId))!
    expect(p.handoffReason).toBeNull()
    expect(p.noKnowledgeFound).toBe(false)
    const system = JSON.stringify(model.requests[0]!.system)
    expect(system).toMatch(/Hand-off: the case is clear, the answer is not/)
    expect(system).not.toMatch(/## Knowledge base \(Notion/)
    expect(system).not.toMatch(/Set \\?`noKnowledgeFound\\?` when/)
  })
})
