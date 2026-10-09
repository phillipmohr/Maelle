/**
 * The decision state machine behind the ticket page: normal → confirm (A twice for irreversible
 * actions) → executing, plus edit, reject → manual, snooze, retry, mark done, case change, undo.
 * `createTicketDecision` is pure (dependencies injected) so the flows are unit tested;
 * `useTicketDecision` wires it to the API, the toaster and navigation.
 */
import { computed, ref, watch, type Ref } from 'vue'
import type {
  ApproveRequest,
  ApproveResponse,
  ConfirmRequiredResponse,
  ConsistencyCheckResponse,
  TicketDetailResponse,
} from '#shared/api'
import { ACTIONS, type ActionType } from '#shared/actions'
import type { CaseType } from '#shared/case-types'
import type { ExecutionSummary, RejectReason } from '#shared/services'
import type { ShortcutDef } from '~/composables/useShortcuts'
import type { TicketActionsApi } from '~/composables/useTickets'
import {
  barNote,
  confirmNote,
  irreversibleNow,
  primaryLabel,
  toEditable,
  toastLines,
  toastTitle,
  type EditableAction,
} from '~/composables/useTicketModel'

export type DecisionPhase = 'normal' | 'confirm' | 'submitting' | 'executing'
export type DecisionView =
  | 'loading'
  | 'researching'
  | 'unclear'
  | 'decide'
  | 'executing'
  | 'failed'
  | 'manual'
  | 'waiting'
  | 'snoozed'
  | 'auto'
  | 'closed'

export type ActionFailure =
  | { kind: 'confirm_required'; irreversible: ConfirmRequiredResponse['irreversible'] }
  | { kind: 'stale'; current: number | null }
  | { kind: 'safety'; message: string }
  | { kind: 'not_available'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'error'; message: string; status: number | null }

interface FetchLikeError {
  response?: { status?: number }
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
}

/** Turns a $fetch error into a decision the UI can act on. */
export function classifyActionError(err: unknown): ActionFailure {
  const e = (err ?? {}) as FetchLikeError
  const status = e.response?.status ?? e.statusCode ?? e.status ?? null
  const data = (e.data ?? {}) as Record<string, unknown>
  const inner = (data.data ?? {}) as Record<string, unknown>
  const message =
    (typeof data.statusMessage === 'string' && data.statusMessage) ||
    (typeof e.statusMessage === 'string' && e.statusMessage) ||
    (typeof data.message === 'string' && data.message) ||
    (typeof e.message === 'string' && e.message) ||
    'Something went wrong'
  if (status == null) {
    return {
      kind: 'network',
      message: 'Could not reach Maelle. Check your connection and try again.',
    }
  }
  if (status === 409) {
    if (data.error === 'confirm_required') {
      return {
        kind: 'confirm_required',
        irreversible: (data.irreversible as ConfirmRequiredResponse['irreversible']) ?? [],
      }
    }
    const current = typeof inner.current === 'number' ? inner.current : null
    return { kind: 'stale', current }
  }
  if (status === 422) return { kind: 'safety', message }
  if (status === 501) return { kind: 'not_available', message }
  if (status === 404) return { kind: 'not_found', message }
  if (status === 400) return { kind: 'invalid', message }
  return { kind: 'error', message, status }
}

export interface DecisionToast {
  done(title: string, lines: string[], footer?: string): unknown
  error(title: string, description?: string): unknown
  info(title: string, description?: string): unknown
  warning(title: string, description?: string): unknown
  /** A toast with one action button ("Save as example?", "Create KB draft"). */
  offer(
    title: string,
    description: string,
    action: { label: string; onClick: () => unknown },
  ): unknown
}

export interface DecisionDeps {
  api: TicketActionsApi
  toast: DecisionToast
  /** Reload the ticket and the lists. */
  refresh: () => Promise<unknown>
  /** Move on after a decision (the next ticket, or the inbox). */
  moveOn: () => void
  /** Debounce for the consistency check (ms); 0 in tests. */
  checkDelay?: number
}

const ADDED_REASON = 'Added by you'

export function createTicketDecision(
  detail: Ref<TicketDetailResponse | null | undefined>,
  deps: DecisionDeps,
) {
  const ticket = computed(() => detail.value?.ticket ?? null)
  const proposal = computed(() => detail.value?.proposal ?? null)
  const executions = computed(() => detail.value?.executions ?? [])

  const phase = ref<DecisionPhase>('normal')
  const busy = ref(false)
  const actions = ref<EditableAction[]>([])
  const replySubject = ref('')
  const replyBody = ref('')
  const editing = ref(false)
  const note = ref('')
  const liveExecutions = ref<ExecutionSummary[]>([])
  const localStatus = ref<'manual' | null>(null)
  const serverIrreversible = ref<ConfirmRequiredResponse['irreversible']>([])
  const mismatches = ref<ConsistencyCheckResponse['mismatches']>([])
  const checkUnavailable = ref(false)
  const lastError = ref<ActionFailure | null>(null)

  function resetFromProposal() {
    actions.value = (proposal.value?.actions ?? []).map(toEditable)
    replySubject.value = proposal.value?.reply?.subject ?? ''
    replyBody.value = proposal.value?.reply?.body ?? ''
    mismatches.value = []
  }
  function resetAll() {
    phase.value = 'normal'
    busy.value = false
    editing.value = false
    note.value = ''
    liveExecutions.value = []
    localStatus.value = null
    serverIrreversible.value = []
    lastError.value = null
    resetFromProposal()
  }
  resetAll()
  watch(
    () => ticket.value?.id,
    () => resetAll(),
  )
  watch(
    () => `${proposal.value?.id ?? ''}:${proposal.value?.version ?? 0}`,
    () => resetFromProposal(),
  )

  const view = computed<DecisionView>(() => {
    const t = ticket.value
    if (!t) return 'loading'
    if (localStatus.value === 'manual') return 'manual'
    switch (t.status) {
      case 'new':
      case 'researching':
        return 'researching'
      case 'needs_decision':
        if (t.caseType === 'unclear' || proposal.value?.caseType === 'unclear') return 'unclear'
        return phase.value === 'executing' ? 'executing' : 'decide'
      case 'executing':
        return 'executing'
      case 'action_failed':
        return phase.value === 'executing' ? 'executing' : 'failed'
      case 'waiting_on_customer':
        return 'waiting'
      case 'snoozed':
        return 'snoozed'
      case 'manual':
        return 'manual'
      case 'auto_pending':
        return 'auto'
      case 'closed':
      default:
        return 'closed'
    }
  })

  const canDecide = computed(
    () => view.value === 'decide' && phase.value !== 'submitting' && phase.value !== 'executing',
  )
  const canEdit = computed(() => view.value === 'decide' || view.value === 'failed')
  /** The draft is still unsent and nothing is running: it can be drafted again (3-dot menu). */
  const canRegenerate = computed(
    () =>
      (view.value === 'decide' || view.value === 'unclear' || view.value === 'snoozed') &&
      phase.value === 'normal' &&
      !busy.value,
  )
  const replyDirty = computed(
    () =>
      replyBody.value !== (proposal.value?.reply?.body ?? '') ||
      replySubject.value !== (proposal.value?.reply?.subject ?? ''),
  )
  const actionsDirty = computed(() =>
    actions.value.some(
      (a) =>
        a.added ||
        a.edited ||
        a.enabled !== (proposal.value?.actions.find((p) => p.id === a.key)?.enabled ?? a.enabled),
    ),
  )
  const dirty = computed(() => replyDirty.value || actionsDirty.value)
  const irreversible = computed(() => irreversibleNow(actions.value))
  const primary = computed(() => primaryLabel(actions.value, proposal.value))
  const normalNote = computed(() =>
    ticket.value ? barNote(actions.value, proposal.value, ticket.value) : '',
  )
  const confirmText = computed(() => confirmNote(actions.value))
  const confirmCount = computed(() =>
    Math.max(irreversible.value.length, serverIrreversible.value.length),
  )

  function fail(f: ActionFailure) {
    lastError.value = f
    switch (f.kind) {
      case 'confirm_required':
        serverIrreversible.value = f.irreversible
        phase.value = 'confirm'
        return
      case 'stale':
        deps.toast.info(
          'Proposal changed',
          'Reloaded the latest version. Check it again before approving.',
        )
        phase.value = 'normal'
        void deps.refresh()
        return
      case 'safety':
        deps.toast.warning('Not for safety tickets', f.message)
        return
      case 'not_available':
        deps.toast.info('Not available yet', 'This part of Maelle is still being built.')
        return
      case 'invalid':
        deps.toast.error('Check the edits', f.message)
        return
      case 'not_found':
        deps.toast.error('Ticket not found', 'It may have been closed elsewhere.')
        void deps.refresh()
        return
      case 'network':
        deps.toast.error('Could not reach Maelle', 'Check your connection and try again.')
        return
      default:
        deps.toast.error('Something went wrong', f.message)
    }
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (busy.value) return null
    busy.value = true
    lastError.value = null
    try {
      return await fn()
    } catch (err) {
      fail(classifyActionError(err))
      return null
    } finally {
      busy.value = false
    }
  }

  function approveBody(): ApproveRequest {
    const p = proposal.value!
    const added = actions.value.filter((a) => a.added && a.enabled)
    return {
      proposalVersion: p.version,
      actions: actions.value
        .filter((a) => !a.added)
        .map((a) => ({
          position: a.position,
          enabled: a.enabled,
          ...(a.edited ? { params: a.params } : {}),
        })),
      ...(replyDirty.value
        ? { reply: { subject: replySubject.value, body: replyBody.value } }
        : {}),
      ...(phase.value === 'confirm' ? { confirmIrreversible: true } : {}),
      ...(added.length > 0
        ? { addedActions: added.map((a) => ({ type: a.type, params: a.params, reason: a.reason })) }
        : {}),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    }
  }

  function celebrate(res: ApproveResponse, word = 'done') {
    const t = ticket.value!
    const title = toastTitle(t, word)
    const lines = toastLines(res.executions, actions.value)
    const description = [
      ...lines.map((l) => `✓ ${l}`),
      '',
      'Moved to the next ticket · View audit trail',
    ].join('\n')
    if (dirty.value) {
      deps.toast.offer(title, description, {
        label: 'Save as example?',
        onClick: () => deps.api.saveExample(),
      })
    } else {
      deps.toast.done(title, lines)
    }
    if (proposal.value?.noKnowledgeFound) {
      deps.toast.offer(
        'No knowledge found for this case',
        'Turn this ticket into a knowledge base draft?',
        {
          label: 'Create KB draft',
          onClick: () => deps.api.createKbDraft(),
        },
      )
    }
  }

  async function settle(res: ApproveResponse, word?: string) {
    liveExecutions.value = res.executions
    const failed = res.executions.some((e) => e.status === 'failed')
    if (failed) {
      deps.toast.error(
        toastTitle(ticket.value!, 'action failed'),
        'Retry the failed action or mark the ticket done.',
      )
      phase.value = 'normal'
      await deps.refresh()
      return
    }
    phase.value = 'executing'
    celebrate(res, word)
    editing.value = false
    void deps.refresh()
    deps.moveOn()
  }

  /** A: approve; when irreversible actions run now, the first A enters confirm mode and the second runs. */
  async function approve() {
    if (!canDecide.value || !proposal.value) return
    if (phase.value === 'normal' && irreversible.value.length > 0) {
      phase.value = 'confirm'
      return
    }
    const body = approveBody()
    const wasConfirm = phase.value === 'confirm'
    phase.value = 'submitting'
    const res = await run(() => deps.api.approve(body))
    if (!res) {
      if (phase.value === 'submitting') phase.value = wasConfirm ? 'confirm' : 'normal'
      return
    }
    await settle(res)
  }

  /** Esc in confirm mode. */
  function back() {
    if (phase.value === 'confirm') phase.value = 'normal'
  }

  function toggleEdit(force?: boolean) {
    if (!canEdit.value) return
    editing.value = force ?? !editing.value
  }
  function discardEdits() {
    resetFromProposal()
    editing.value = false
  }

  function setEnabled(key: string, enabled: boolean) {
    const a = actions.value.find((x) => x.key === key)
    if (!a) return
    a.enabled = enabled
    scheduleCheck()
  }
  function setParams(key: string, params: Record<string, unknown>) {
    const a = actions.value.find((x) => x.key === key)
    if (!a) return
    a.params = { ...params }
    const original = proposal.value?.actions.find((p) => p.id === key)
    a.edited = a.added ? true : JSON.stringify(original?.params ?? {}) !== JSON.stringify(a.params)
    scheduleCheck()
  }
  function defaultParams(type: ActionType): Record<string, unknown> {
    const t = ticket.value
    switch (type) {
      case 'send_reply':
        return { to: t?.customerEmail ?? '', includeAttachments: true }
      case 'store_release_notification_email':
        return { email: t?.customerEmail ?? '' }
      case 'create_linear_ticket':
        return {
          title: t?.subject ?? '',
          description: '',
          label: 'Bug',
          customerEmail: t?.customerEmail ?? '',
        }
      case 'delete_account':
        return { instaradarUserId: t?.instaradarUserId ?? '', email: t?.customerEmail ?? '' }
      case 'stop_failed_payment_retries':
        return { stripeCustomerId: t?.stripeCustomerId ?? '' }
      case 'store_cancellation_reason':
        return {
          stripeCustomerId: t?.stripeCustomerId ?? '',
          feedback: 'other',
          comment: 'Not stated',
        }
      case 'create_coupon':
        return {
          kind: 'percent',
          percentOff: 20,
          duration: 'once',
          applyTo: 'subscription',
          stripeCustomerId: t?.stripeCustomerId ?? '',
        }
      case 'refund_latest_payment':
        return { amountCents: 0, currency: 'usd', reason: 'requested_by_customer' }
      case 'remove_from_tracking':
        return { instagramHandle: '', reason: '' }
      default:
        return {}
    }
  }
  /** "+ Add action from the predefined list". */
  function addAction(type: ActionType) {
    if (actions.value.some((a) => a.type === type)) return
    const maxPos = Math.max(-1, ...actions.value.map((a) => a.position))
    actions.value.push({
      key: `added:${type}`,
      position: maxPos + 1,
      type,
      params: defaultParams(type),
      reason: ADDED_REASON,
      stage: 'now',
      requiredForReply: false,
      enabled: true,
      added: true,
      edited: true,
    })
    actions.value.sort((a, b) => ACTIONS[a.type].order - ACTIONS[b.type].order)
    scheduleCheck()
  }
  function removeAction(key: string) {
    actions.value = actions.value.filter((a) => !(a.key === key && a.added))
    scheduleCheck()
  }
  const availableActions = computed(() =>
    (Object.keys(ACTIONS) as ActionType[])
      .filter((t) => !actions.value.some((a) => a.type === t))
      .sort((a, b) => ACTIONS[a].order - ACTIONS[b].order),
  )

  let checkTimer: ReturnType<typeof setTimeout> | null = null
  /** Consistency check (agent ticket) after edits; silent when the endpoint is not there yet. */
  function scheduleCheck() {
    if (checkUnavailable.value || !ticket.value) return
    if (checkTimer) clearTimeout(checkTimer)
    // Two seconds of quiet before the model check: every check is a Claude call (IRDR-463).
    const delay = deps.checkDelay ?? 2000
    const go = async () => {
      checkTimer = null
      if (!dirty.value) {
        mismatches.value = []
        return
      }
      try {
        const res = await deps.api.consistencyCheck({
          replyBody: replyBody.value,
          enabledActions: actions.value
            .filter((a) => a.enabled)
            .map((a) => ({ type: a.type, params: a.params })),
        })
        mismatches.value = res.mismatches ?? []
      } catch (err) {
        const f = classifyActionError(err)
        if (f.kind === 'not_available' || f.kind === 'not_found') checkUnavailable.value = true
        mismatches.value = []
      }
    }
    if (delay === 0) void go()
    else checkTimer = setTimeout(() => void go(), delay)
  }
  watch(replyBody, () => scheduleCheck())

  async function reject(reason: RejectReason, rejectNote?: string) {
    const res = await run(() =>
      deps.api.reject({ reason, ...(rejectNote ? { note: rejectNote } : {}) }),
    )
    if (!res) return false
    localStatus.value = 'manual'
    editing.value = false
    deps.toast.info(
      reason === 'handle_myself' ? 'Yours now' : 'Rejected',
      reason === 'handle_myself'
        ? 'Write the reply below, or mark the ticket as done.'
        : 'The proposal is set aside. Write the reply yourself and pick the actions.',
    )
    void deps.refresh()
    return true
  }

  async function manualSend(input: {
    body: string
    subject?: string
    actions: { type: ActionType; params: Record<string, unknown> }[]
    handledManually: boolean
  }) {
    const t = ticket.value
    if (!t) return false
    const res = await run(() =>
      deps.api.manualSend({
        reply: {
          to: t.customerEmail,
          subject: input.subject?.trim() || `Re: ${t.subject ?? ''}`.trim(),
          body: input.body,
        },
        actions: input.actions,
        handledManually: input.handledManually,
      }),
    )
    if (!res) return false
    liveExecutions.value = res.executions
    const lines = toastLines(res.executions, input.actions)
    // A reply written by hand is worth remembering (learning loop, IRDR-459).
    deps.toast.offer(
      toastTitle(t, 'sent'),
      [...lines.map((l) => `✓ ${l}`), '', 'Moved to the next ticket · View audit trail'].join('\n'),
      { label: 'Save as example?', onClick: () => deps.api.saveExample() },
    )
    void deps.refresh()
    deps.moveOn()
    return true
  }

  async function markDone(doneNote: string) {
    const t = ticket.value
    if (!t || !doneNote.trim()) return false
    const res = await run(() => deps.api.markDone({ note: doneNote.trim() }))
    if (!res) return false
    deps.toast.done(toastTitle(t, 'marked done'), [doneNote.trim()], 'Moved to the next ticket')
    void deps.refresh()
    deps.moveOn()
    return true
  }

  /** ⏎ in failed mode. */
  async function retry() {
    if (view.value !== 'failed') return
    phase.value = 'submitting'
    const res = await run(() => deps.api.retry())
    if (!res) {
      phase.value = 'normal'
      return
    }
    await settle(res, 'done after retry')
  }

  async function snooze(until: Date) {
    const t = ticket.value
    if (!t) return false
    if (t.riskLevel === 'safety') {
      deps.toast.warning(
        'Not for safety tickets',
        'Safety tickets stay on top until they are handled.',
      )
      return false
    }
    const res = await run(() => deps.api.snooze({ until: until.toISOString() }))
    if (!res) return false
    deps.toast.info(
      toastTitle(t, 'snoozed'),
      `Returns ${until.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`,
    )
    void deps.refresh()
    deps.moveOn()
    return true
  }

  async function unsnooze() {
    const res = await run(() => deps.api.unsnooze())
    if (!res) return false
    deps.toast.info('Back in the inbox', 'The ticket needs your decision again.')
    await deps.refresh()
    return true
  }

  async function setCase(caseType: CaseType) {
    const res = await run(() => deps.api.setCase({ caseType }))
    if (!res) return false
    deps.toast.info('Case changed', 'AnastasAI is researching it again with the new case.')
    await deps.refresh()
    return true
  }

  async function rerun() {
    const res = await run(() => deps.api.rerun({ trigger: 'rerun' }))
    if (!res) return false
    deps.toast.info('Research is running again', 'The proposal updates when it finishes.')
    await deps.refresh()
    return true
  }

  /** Drafts the reply again (templates, protocol or settings may have changed); edits are dropped. */
  async function regenerate() {
    if (!canRegenerate.value) return false
    editing.value = false
    const res = await run(() => deps.api.rerun({ trigger: 'rerun' }))
    if (!res) return false
    deps.toast.info(
      'Regenerating the reply',
      'AnastasAI drafts it again with the current templates and settings.',
    )
    await deps.refresh()
    return true
  }

  async function undo() {
    const res = await run(() => deps.api.undo())
    if (!res) return false
    const n = res.cancelled.length
    deps.toast.info(
      n > 0 ? `Undone · ${n} ${n === 1 ? 'action' : 'actions'} cancelled` : 'Nothing to undo',
      res.alreadyRan.length > 0
        ? `${res.alreadyRan.length} already ran and stay in the audit log.`
        : undefined,
    )
    await deps.refresh()
    return true
  }

  return {
    ticket,
    proposal,
    executions,
    view,
    phase,
    busy,
    actions,
    availableActions,
    replySubject,
    replyBody,
    editing,
    note,
    liveExecutions,
    serverIrreversible,
    mismatches,
    checkUnavailable,
    lastError,
    canDecide,
    canEdit,
    canRegenerate,
    dirty,
    replyDirty,
    irreversible,
    primary,
    normalNote,
    confirmText,
    confirmCount,
    approve,
    back,
    toggleEdit,
    discardEdits,
    setEnabled,
    setParams,
    addAction,
    removeAction,
    reject,
    manualSend,
    markDone,
    retry,
    snooze,
    unsnooze,
    setCase,
    rerun,
    regenerate,
    undo,
    scheduleCheck,
  }
}

export type TicketDecision = ReturnType<typeof createTicketDecision>

export interface TicketShortcutContext {
  decision: TicketDecision
  /** Dialog or picker open: only Esc and the dialog's own keys should work. */
  overlayOpen: () => boolean
  openReject: () => void
  openSnooze: () => void
  openMarkDone: () => void
  next: () => void
  prev: () => void
  toInbox: () => void
  toggleFilters: () => void
}

/** The ticket page shortcuts (scope 'ticket'), registered with useShortcuts(). */
export function ticketShortcutDefs(ctx: TicketShortcutContext): ShortcutDef[] {
  const d = ctx.decision
  const free = () => !ctx.overlayOpen()
  return [
    {
      id: 'ticket.next',
      keys: 'j',
      label: 'Next ticket',
      group: 'Ticket',
      scope: 'ticket',
      when: free,
      handler: ctx.next,
    },
    {
      id: 'ticket.prev',
      keys: 'k',
      label: 'Previous ticket',
      group: 'Ticket',
      scope: 'ticket',
      when: free,
      handler: ctx.prev,
    },
    {
      id: 'ticket.approve',
      keys: 'a',
      label: 'Approve (twice for irreversible actions)',
      group: 'Decision',
      scope: 'ticket',
      when: () => free() && d.view.value === 'decide',
      handler: () => void d.approve(),
    },
    {
      id: 'ticket.approve.editor',
      keys: 'mod+enter',
      label: 'Approve from the editor',
      group: 'Decision',
      scope: 'ticket',
      allowInInput: true,
      when: () => free() && d.view.value === 'decide',
      handler: () => void d.approve(),
    },
    {
      id: 'ticket.edit',
      keys: 'e',
      label: 'Edit the reply',
      group: 'Decision',
      scope: 'ticket',
      when: () => free() && d.canEdit.value,
      handler: () => d.toggleEdit(),
    },
    {
      id: 'ticket.reject',
      keys: 'r',
      label: 'Reject',
      group: 'Decision',
      scope: 'ticket',
      when: () => free() && d.view.value === 'decide',
      handler: ctx.openReject,
    },
    {
      id: 'ticket.snooze',
      keys: 's',
      label: 'Snooze',
      group: 'Decision',
      scope: 'ticket',
      when: () =>
        free() &&
        (d.view.value === 'decide' || d.view.value === 'unclear') &&
        d.ticket.value?.riskLevel !== 'safety',
      handler: ctx.openSnooze,
    },
    {
      id: 'ticket.unsnooze',
      keys: 's',
      label: 'Unsnooze',
      group: 'Decision',
      scope: 'ticket',
      when: () => free() && d.view.value === 'snoozed',
      handler: () => void d.unsnooze(),
    },
    {
      id: 'ticket.retry',
      keys: 'enter',
      label: 'Retry the failed action',
      group: 'Decision',
      scope: 'ticket',
      when: () => free() && d.view.value === 'failed',
      handler: () => void d.retry(),
    },
    {
      id: 'ticket.markdone',
      keys: 'm',
      label: 'Mark as done manually',
      group: 'Decision',
      scope: 'ticket',
      when: () =>
        free() &&
        (d.view.value === 'failed' || d.view.value === 'manual' || d.view.value === 'waiting'),
      handler: ctx.openMarkDone,
    },
    {
      id: 'ticket.filters',
      keys: 'f',
      label: 'Filter the list',
      group: 'Ticket',
      scope: 'ticket',
      when: free,
      handler: ctx.toggleFilters,
    },
    {
      id: 'ticket.escape',
      keys: 'escape',
      label: 'Back (cancel confirm or editing, else the inbox)',
      group: 'Ticket',
      scope: 'ticket',
      allowInInput: true,
      when: free,
      handler: () => {
        if (d.phase.value === 'confirm') return d.back()
        if (d.editing.value) return d.toggleEdit(false)
        ctx.toInbox()
      },
    },
  ]
}

/** Nuxt wrapper: real API, toasts and navigation. `ticketId` is a getter: the page is reused across tickets. */
export function useTicketDecision(
  detail: Ref<TicketDetailResponse | null | undefined>,
  opts: {
    ticketId: () => string
    refresh: () => Promise<unknown>
    nextTicket: () => number | null
  },
) {
  const current = () => useTicketActions(opts.ticketId())
  const api: TicketActionsApi = {
    approve: (b) => current().approve(b),
    reject: (b) => current().reject(b),
    manualSend: (b) => current().manualSend(b),
    snooze: (b) => current().snooze(b),
    unsnooze: () => current().unsnooze(),
    retry: () => current().retry(),
    markDone: (b) => current().markDone(b),
    setCase: (b) => current().setCase(b),
    undo: () => current().undo(),
    rerun: (b) => current().rerun(b),
    consistencyCheck: (b) => current().consistencyCheck(b),
    saveExample: () => current().saveExample(),
    createKbDraft: () => current().createKbDraft(),
  }
  const t = useToast()
  const toast: DecisionToast = {
    done: (title, lines, footer) => t.done(title, lines, footer),
    error: (title, d) => t.error(title, d),
    info: (title, d) => t.info(title, d),
    warning: (title, d) => t.warning(title, d),
    offer: (title, description, action) =>
      t.toast.success(title, {
        description,
        duration: 12_000,
        action: {
          label: action.label,
          onClick: () => {
            // Learning endpoints (IRDR-459): { ticketId } in, { url } out; 409 = no reply sent yet, 503 = offline.
            Promise.resolve(action.onClick())
              .then((res) => {
                const url = (res as { url?: string } | undefined)?.url
                if (url && import.meta.client) window.open(url, '_blank', 'noopener')
                t.info('Saved to Notion', url ? 'Opened in a new tab.' : undefined)
              })
              .catch((err: unknown) => {
                const status =
                  (err as { response?: { status?: number }; statusCode?: number })?.response
                    ?.status ?? (err as { statusCode?: number })?.statusCode
                if (status === 409) t.info('Not yet', 'Save it once the reply has been sent.')
                else if (status === 503)
                  t.warning('Not connected', 'Notion is not configured in this environment.')
                else {
                  const f = classifyActionError(err)
                  if (f.kind === 'not_available')
                    t.info('Not available yet', 'This part of Maelle is still being built.')
                  else
                    t.error('Could not save', 'message' in f ? f.message : 'Something went wrong')
                }
              })
          },
        },
      }),
  }
  return createTicketDecision(detail, {
    api,
    toast,
    refresh: opts.refresh,
    moveOn: () => {
      const n = opts.nextTicket()
      void navigateTo(n ? `/anastasai/t/${n}` : '/anastasai')
    },
  })
}
