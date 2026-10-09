// @vitest-environment happy-dom
/**
 * The decision state machine and the keyboard flow, with a fake API: A approves a routine ticket,
 * A twice runs irreversible actions, Esc backs out, the server's 409s are handled, edits travel.
 */
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApproveResponse, TicketDetailResponse } from '../../shared/api'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketDetail } from '../../shared/seed/views'
import {
  dispatchKeydown,
  resetShortcutsForTests,
  useShortcuts,
  useShortcutScope,
} from '../../app/composables/useShortcuts'
import {
  classifyActionError,
  createTicketDecision,
  ticketShortcutDefs,
  type DecisionDeps,
} from '../../app/composables/useTicketDecision'
import type { TicketActionsApi } from '../../app/composables/useTickets'

const now = new Date('2026-09-27T10:00:00')
const seed = buildSeed(now)

function fetchError(status: number, data?: unknown) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status },
    statusCode: status,
    data,
  })
}

function okApprove(detail: TicketDetailResponse): ApproveResponse {
  return {
    decisionId: 'd1',
    ticketStatus: 'closed',
    executions: detail.proposal!.actions.map((a) => ({
      executionId: `e${a.position}`,
      type: a.type,
      status: a.stage === 'after_confirmation' ? 'queued' : 'succeeded',
    })),
  }
}

function setup(number: number, overrides: Partial<TicketActionsApi> = {}) {
  const detail = ref<TicketDetailResponse | null>(seedTicketDetail(seed, String(number)))
  const api = {
    approve: vi.fn(async () => okApprove(detail.value!)),
    reject: vi.fn(async () => ({ decisionId: 'r1', ticketStatus: 'manual' })),
    manualSend: vi.fn(async () => ({
      decisionId: 'm1',
      ticketStatus: 'closed',
      executions: [{ executionId: 'x', type: 'send_reply' as const, status: 'succeeded' as const }],
    })),
    snooze: vi.fn(async () => ({ ok: true as const })),
    unsnooze: vi.fn(async () => ({ ok: true as const })),
    retry: vi.fn(async () => ({ decisionId: 'rt', ticketStatus: 'closed', executions: [] })),
    markDone: vi.fn(async () => ({ ok: true as const })),
    setCase: vi.fn(async () => ({ ok: true as const })),
    undo: vi.fn(async () => ({ cancelled: [], alreadyRan: [] })),
    rerun: vi.fn(async () => ({ runId: 'run' })),
    consistencyCheck: vi.fn(async () => ({ mismatches: [] })),
    saveExample: vi.fn(async () => ({ notionPageId: 'p', url: 'u' })),
    createKbDraft: vi.fn(async () => ({ notionPageId: 'p', url: 'u' })),
    ...overrides,
  } as unknown as TicketActionsApi
  const toast = { done: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), offer: vi.fn() }
  const deps: DecisionDeps = {
    api,
    toast,
    refresh: vi.fn(async () => {}),
    moveOn: vi.fn(),
    checkDelay: 0,
  }
  const decision = createTicketDecision(detail, deps)
  return { detail, api, toast, deps, decision }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('decision state machine', () => {
  it('approves a routine ticket with one A and moves on with the toast', async () => {
    const { decision, api, toast, deps } = setup(4824)
    expect(decision.view.value).toBe('decide')
    expect(decision.primary.value).toBe('Approve & execute')
    await decision.approve()
    expect(api.approve).toHaveBeenCalledTimes(1)
    const body = (api.approve as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      proposalVersion: number
      actions: unknown[]
      confirmIrreversible?: boolean
    }
    expect(body.proposalVersion).toBe(1)
    expect(body.actions).toHaveLength(3)
    expect(body.confirmIrreversible).toBeUndefined()
    expect(toast.done).toHaveBeenCalledWith('#4824 Tom Becker · done', [
      'Cancelled at period end',
      'Stored cancellation reason',
      'Sent reply',
    ])
    expect(deps.moveOn).toHaveBeenCalledTimes(1)
    expect(decision.phase.value).toBe('executing')
    expect(decision.view.value).toBe('executing')
  })

  it('needs A twice for irreversible actions and Esc backs out', async () => {
    const { decision, api } = setup(4809)
    await decision.approve()
    expect(decision.phase.value).toBe('confirm')
    expect(decision.confirmCount.value).toBe(2)
    expect(decision.confirmText.value).toBe(
      'Refund $13.07 to Visa ··2291 · Cancel immediately and delete 2 profiles',
    )
    expect(api.approve).not.toHaveBeenCalled()
    decision.back()
    expect(decision.phase.value).toBe('normal')
    await decision.approve()
    await decision.approve()
    expect(api.approve).toHaveBeenCalledTimes(1)
    expect((api.approve as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      confirmIrreversible: true,
      proposalVersion: 2,
    })
  })

  it('enters confirm mode when the server answers 409 confirm_required', async () => {
    const irreversible = [{ position: 0, type: 'refund_latest_payment', effect: 'Refund $13.07' }]
    const { decision, api, toast } = setup(4824, {
      approve: vi.fn(async () => {
        throw fetchError(409, { error: 'confirm_required', irreversible })
      }),
    })
    await decision.approve()
    expect(api.approve).toHaveBeenCalledTimes(1)
    expect(decision.phase.value).toBe('confirm')
    expect(decision.serverIrreversible.value).toEqual(irreversible)
    expect(decision.confirmCount.value).toBe(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reloads on a stale version, toasts on 422, 501 and network errors', async () => {
    const stale = setup(4824, {
      approve: vi.fn(async () => {
        throw fetchError(409, {
          statusCode: 409,
          statusMessage: 'Stale proposal version',
          data: { error: 'stale_version', current: 2 },
        })
      }),
    })
    await stale.decision.approve()
    expect(stale.deps.refresh).toHaveBeenCalled()
    expect(stale.toast.info).toHaveBeenCalledWith('Proposal changed', expect.any(String))
    expect(stale.decision.phase.value).toBe('normal')

    const safety = setup(4824, {
      snooze: vi.fn(async () => {
        throw fetchError(422, { statusMessage: 'Safety tickets cannot be snoozed' })
      }),
    })
    await safety.decision.snooze(new Date(now.getTime() + 3600_000))
    expect(safety.toast.warning).toHaveBeenCalledWith(
      'Not for safety tickets',
      'Safety tickets cannot be snoozed',
    )

    const notYet = setup(4824, {
      reject: vi.fn(async () => {
        throw fetchError(501, { statusMessage: 'Reject is not implemented yet. Owner: IRDR-457.' })
      }),
    })
    expect(await notYet.decision.reject('wrong_tone')).toBe(false)
    expect(notYet.toast.info).toHaveBeenCalledWith('Not available yet', expect.any(String))
    expect(notYet.decision.view.value).toBe('decide')

    const offline = setup(4824, {
      approve: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    })
    await offline.decision.approve()
    expect(offline.toast.error).toHaveBeenCalledWith(
      'Could not reach Maelle',
      'Check your connection and try again.',
    )
    expect(offline.decision.phase.value).toBe('normal')
  })

  it('sends edits: reply, toggled and edited actions, added actions; offers to save as example', async () => {
    const { decision, api, toast } = setup(4824)
    decision.toggleEdit(true)
    decision.replyBody.value = 'Hi Tom,\n\nDone, no charge again.'
    const store = decision.actions.value.find((a) => a.type === 'store_cancellation_reason')!
    decision.setEnabled(store.key, false)
    const cancel = decision.actions.value.find((a) => a.type === 'cancel_at_period_end')!
    decision.setParams(cancel.key, { ...cancel.params, accessUntil: '2026-10-20' })
    decision.addAction('create_coupon')
    expect(decision.availableActions.value).not.toContain('create_coupon')
    expect(decision.dirty.value).toBe(true)
    await tick()
    expect(api.consistencyCheck).toHaveBeenCalled()
    await decision.approve()
    const body = (api.approve as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(body.reply).toMatchObject({ body: 'Hi Tom,\n\nDone, no charge again.' })
    const acts = body.actions as {
      position: number
      enabled: boolean
      params?: Record<string, unknown>
    }[]
    expect(acts.find((a) => a.position === store.position)!.enabled).toBe(false)
    expect(acts.find((a) => a.position === cancel.position)!.params).toMatchObject({
      accessUntil: '2026-10-20',
    })
    expect(body.addedActions).toEqual([
      { type: 'create_coupon', params: expect.any(Object), reason: 'Added by you' },
    ])
    expect(toast.offer).toHaveBeenCalledWith(
      '#4824 Tom Becker · done',
      expect.any(String),
      expect.objectContaining({ label: 'Save as example?' }),
    )
    expect(toast.done).not.toHaveBeenCalled()
  })

  it('offers a KB draft when no knowledge was found', async () => {
    const { detail, decision, toast } = setup(4824)
    detail.value = {
      ...detail.value!,
      proposal: { ...detail.value!.proposal!, noKnowledgeFound: true },
    }
    await decision.approve()
    expect(toast.offer).toHaveBeenCalledWith(
      'No knowledge found for this case',
      expect.any(String),
      expect.objectContaining({ label: 'Create KB draft' }),
    )
  })

  it('reject goes to manual mode, manual send and mark done move on', async () => {
    const { decision, api, deps, toast } = setup(4824)
    expect(await decision.reject('wrong_actions')).toBe(true)
    expect(decision.view.value).toBe('manual')
    expect(
      await decision.manualSend({
        body: 'Hi Tom',
        actions: [{ type: 'cancel_at_period_end', params: { stripeSubscriptionId: 'sub_1' } }],
        handledManually: false,
      }),
    ).toBe(true)
    expect(api.manualSend).toHaveBeenCalledWith({
      reply: { to: 'tom.becker@web.de', subject: 'Re: Unsubscribe', body: 'Hi Tom' },
      actions: [{ type: 'cancel_at_period_end', params: { stripeSubscriptionId: 'sub_1' } }],
      handledManually: false,
    })
    expect(deps.moveOn).toHaveBeenCalledTimes(1)
    expect(await decision.markDone('   ')).toBe(false)
    expect(await decision.markDone('Stored by hand')).toBe(true)
    expect(toast.done).toHaveBeenLastCalledWith(
      '#4824 Tom Becker · marked done',
      ['Stored by hand'],
      'Moved to the next ticket',
    )
  })

  it('retries a failed action from failed mode and refuses to snooze safety tickets client side', async () => {
    const failed = setup(4820)
    expect(failed.decision.view.value).toBe('failed')
    await failed.decision.retry()
    expect(failed.api.retry).toHaveBeenCalledTimes(1)
    expect(failed.deps.moveOn).toHaveBeenCalledTimes(1)
    const { detail, decision, api, toast } = setup(4825)
    detail.value = { ...detail.value!, ticket: { ...detail.value!.ticket, riskLevel: 'safety' } }
    expect(await decision.snooze(new Date(now.getTime() + 3600_000))).toBe(false)
    expect(api.snooze).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalled()
  })

  it('regenerates an unsent reply: drops edits, reruns, refuses while busy or after the decision', async () => {
    const { decision, api, toast, deps, detail } = setup(4824)
    expect(decision.canRegenerate.value).toBe(true)
    decision.toggleEdit(true)
    decision.replyBody.value = 'My own words'
    expect(await decision.regenerate()).toBe(true)
    expect(api.rerun).toHaveBeenCalledWith({ trigger: 'rerun' })
    expect(decision.editing.value).toBe(false)
    expect(toast.info).toHaveBeenCalledWith('Regenerating the reply', expect.any(String))
    expect(deps.refresh).toHaveBeenCalled()

    const set = (status: TicketDetailResponse['ticket']['status']) =>
      (detail.value = { ...detail.value!, ticket: { ...detail.value!.ticket, status } })
    set('snoozed')
    expect(decision.canRegenerate.value).toBe(true)
    for (const s of ['researching', 'executing', 'auto_pending', 'closed', 'manual'] as const) {
      set(s)
      expect(decision.canRegenerate.value, s).toBe(false)
    }
    set('closed')
    expect(await decision.regenerate()).toBe(false)
    expect(api.rerun).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed regenerate and keeps the draft', async () => {
    const { decision, toast } = setup(4824, {
      rerun: vi.fn(async () => {
        throw fetchError(500)
      }),
    })
    expect(await decision.regenerate()).toBe(false)
    expect(toast.error).toHaveBeenCalled()
    expect(decision.canRegenerate.value).toBe(true)
  })

  it('maps views for every ticket status', () => {
    const { detail, decision } = setup(4824)
    const set = (status: TicketDetailResponse['ticket']['status']) =>
      (detail.value = { ...detail.value!, ticket: { ...detail.value!.ticket, status } })
    set('researching')
    expect(decision.view.value).toBe('researching')
    set('waiting_on_customer')
    expect(decision.view.value).toBe('waiting')
    set('snoozed')
    expect(decision.view.value).toBe('snoozed')
    set('auto_pending')
    expect(decision.view.value).toBe('auto')
    set('closed')
    expect(decision.view.value).toBe('closed')
    set('manual')
    expect(decision.view.value).toBe('manual')
    set('needs_decision')
    detail.value = { ...detail.value!, ticket: { ...detail.value!.ticket, caseType: 'unclear' } }
    expect(decision.view.value).toBe('unclear')
  })
})

describe('classifyActionError', () => {
  it('reads the status and the body shapes the stubs and the executor use', () => {
    expect(
      classifyActionError(fetchError(409, { error: 'confirm_required', irreversible: [] })).kind,
    ).toBe('confirm_required')
    expect(
      classifyActionError(fetchError(409, { data: { error: 'stale_version', current: 3 } })),
    ).toEqual({ kind: 'stale', current: 3 })
    expect(classifyActionError(fetchError(422, { statusMessage: 'no' })).kind).toBe('safety')
    expect(classifyActionError(fetchError(501)).kind).toBe('not_available')
    expect(classifyActionError(fetchError(404)).kind).toBe('not_found')
    expect(classifyActionError(fetchError(400, { statusMessage: 'bad params' }))).toEqual({
      kind: 'invalid',
      message: 'bad params',
    })
    expect(classifyActionError(fetchError(500, { statusMessage: 'boom' }))).toEqual({
      kind: 'error',
      message: 'boom',
      status: 500,
    })
    expect(classifyActionError(new TypeError('Failed to fetch')).kind).toBe('network')
    expect(classifyActionError(null).kind).toBe('network')
  })
})

describe('keyboard flow', () => {
  beforeEach(() => resetShortcutsForTests())

  function key(k: string, init: Partial<KeyboardEventInit> = {}) {
    return new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  }

  it('A, A confirms and runs; Esc backs out; R, S, E and ⏎ reach their handlers', async () => {
    const { decision, api } = setup(4809)
    const ctx = {
      openReject: vi.fn(),
      openSnooze: vi.fn(),
      openMarkDone: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      toInbox: vi.fn(),
      toggleFilters: vi.fn(),
    }
    let overlay = false
    useShortcutScope('ticket')
    useShortcuts().register(ticketShortcutDefs({ decision, overlayOpen: () => overlay, ...ctx }))

    expect(dispatchKeydown(key('a'))).toBe(true)
    await tick()
    expect(decision.phase.value).toBe('confirm')
    dispatchKeydown(key('Escape'))
    expect(decision.phase.value).toBe('normal')
    dispatchKeydown(key('a'))
    await tick()
    dispatchKeydown(key('a'))
    await tick()
    expect(api.approve).toHaveBeenCalledTimes(1)
    expect((api.approve as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({
      confirmIrreversible: true,
    })

    const routine = setup(4824)
    resetShortcutsForTests()
    useShortcutScope('ticket')
    useShortcuts().register(
      ticketShortcutDefs({ decision: routine.decision, overlayOpen: () => overlay, ...ctx }),
    )
    dispatchKeydown(key('r'))
    expect(ctx.openReject).toHaveBeenCalledTimes(1)
    dispatchKeydown(key('s'))
    expect(ctx.openSnooze).toHaveBeenCalledTimes(1)
    dispatchKeydown(key('e'))
    expect(routine.decision.editing.value).toBe(true)
    dispatchKeydown(key('Escape'))
    expect(routine.decision.editing.value).toBe(false)
    dispatchKeydown(key('Escape'))
    expect(ctx.toInbox).toHaveBeenCalledTimes(1)
    dispatchKeydown(key('j'))
    dispatchKeydown(key('k'))
    expect(ctx.next).toHaveBeenCalledTimes(1)
    expect(ctx.prev).toHaveBeenCalledTimes(1)

    // With a dialog open, only the dialog owns the keys.
    overlay = true
    dispatchKeydown(key('a'))
    await tick()
    expect(routine.api.approve).not.toHaveBeenCalled()
    overlay = false

    // ⌘⏎ approves from inside the editor, plain A does not.
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    const inInput = key('a')
    Object.defineProperty(inInput, 'target', { value: textarea })
    dispatchKeydown(inInput)
    await tick()
    expect(routine.api.approve).not.toHaveBeenCalled()
    const cmdEnter = key('Enter', { metaKey: true })
    Object.defineProperty(cmdEnter, 'target', { value: textarea })
    dispatchKeydown(cmdEnter)
    await tick()
    expect(routine.api.approve).toHaveBeenCalledTimes(1)
  })

  it('⏎ retries in failed mode and M opens mark done', async () => {
    const { decision, api } = setup(4820)
    const openMarkDone = vi.fn()
    useShortcutScope('ticket')
    useShortcuts().register(
      ticketShortcutDefs({
        decision,
        overlayOpen: () => false,
        openReject: vi.fn(),
        openSnooze: vi.fn(),
        openMarkDone,
        next: vi.fn(),
        prev: vi.fn(),
        toInbox: vi.fn(),
        toggleFilters: vi.fn(),
      }),
    )
    dispatchKeydown(key('m'))
    expect(openMarkDone).toHaveBeenCalledTimes(1)
    dispatchKeydown(key('Enter'))
    await tick()
    expect(api.retry).toHaveBeenCalledTimes(1)
    // After the retry ran, the ticket is executing: M no longer applies.
    dispatchKeydown(key('m'))
    expect(openMarkDone).toHaveBeenCalledTimes(1)
  })
})
