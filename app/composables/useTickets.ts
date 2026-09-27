/**
 * Data access for tickets. Wraps the stubbed routes today and the real ones later without callers
 * changing. Owners: list/detail routes IRDR-458, decision routes IRDR-457.
 */
import type {
  ApproveRequest,
  ApproveResponse,
  MarkDoneRequest,
  RejectRequest,
  RerunRequest,
  SetCaseRequest,
  SnoozeRequest,
  TicketDetailResponse,
  TicketListQuery,
  TicketListResponse,
  UndoResponse,
} from '#shared/api'

export function useTicketList(query: Ref<TicketListQuery> | TicketListQuery = {}) {
  const q = isRef(query) ? query : ref(query)
  return useFetch<TicketListResponse>('/api/tickets', {
    key: 'tickets:list',
    query: q,
    default: () => ({
      items: [],
      nextCursor: null,
      counts: {
        needsDecision: 0,
        waitingOnCustomer: 0,
        snoozed: 0,
        autoPending: 0,
        closedLast3Days: 0,
        closedToday: 0,
      },
    }),
  })
}

export function useTicket(id: Ref<string> | string) {
  const idRef = isRef(id) ? id : ref(id)
  return useFetch<TicketDetailResponse>(() => `/api/tickets/${encodeURIComponent(idRef.value)}`, {
    key: `tickets:${idRef.value}`,
    watch: [idRef],
  })
}

export function useTicketActions(ticketId: string) {
  const base = `/api/tickets/${encodeURIComponent(ticketId)}`
  const post = <T>(path: string, body?: Record<string, unknown>) =>
    $fetch<T>(`${base}/${path}`, { method: 'POST', body: body ?? {} })
  return {
    approve: (body: ApproveRequest) => post<ApproveResponse>('approve', { ...body }),
    reject: (body: RejectRequest) => post<{ decisionId: string }>('reject', { ...body }),
    snooze: (body: SnoozeRequest) => post<{ ok: true }>('snooze', { ...body }),
    unsnooze: () => post<{ ok: true }>('unsnooze'),
    retry: () => post<ApproveResponse>('retry'),
    markDone: (body: MarkDoneRequest) => post<{ ok: true }>('mark-done', { ...body }),
    setCase: (body: SetCaseRequest) => post<{ ok: true }>('case', { ...body }),
    undo: () => post<UndoResponse>('undo'),
    rerun: (body: RerunRequest = {}) => post<{ runId: string }>('rerun', { ...body }),
  }
}
