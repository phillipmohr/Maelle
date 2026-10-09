/**
 * Data access for tickets. Wraps the stubbed routes today and the real ones later without callers
 * changing. Owners: list/detail routes IRDR-458, decision routes IRDR-457, rerun and consistency
 * check IRDR-456, learning IRDR-459.
 */
import type {
  ApproveRequest,
  ApproveResponse,
  ConsistencyCheckRequest,
  ConsistencyCheckResponse,
  LearningResponse,
  ManualSendRequest,
  MarkDoneRequest,
  RejectRequest,
  RegenerateDraftsResponse,
  RerunRequest,
  SetCaseRequest,
  SnoozeRequest,
  TicketDetailResponse,
  TicketListItem,
  TicketListQuery,
  TicketListResponse,
  UndoResponse,
} from '#shared/api'
import { CLOSED_PAGE_SIZE } from '#shared/ticket-repository'

export const TICKET_LIST_KEY = 'tickets:list'
export const CLOSED_LIST_KEY = 'tickets:closed'

function emptyList(): TicketListResponse {
  return {
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
  }
}

/** Every open, parked and recently closed ticket (open first). Shared by the layout, the inbox and the ticket list. */
export function useTicketList(query: Ref<TicketListQuery> | TicketListQuery = {}) {
  const q = isRef(query) ? query : ref(query)
  return useFetch<TicketListResponse>('/api/tickets', {
    key: TICKET_LIST_KEY,
    query: q,
    default: emptyList,
  })
}

export interface ClosedFilters {
  resolution?: TicketListQuery['resolution']
  caseType?: TicketListQuery['caseType']
  from?: string
  to?: string
  q?: string
}

/**
 * The closed history: first page through useFetch (server rendered, awaited), further pages
 * appended with the cursor. Changing the filters resets the appended pages.
 */
export async function useClosedTickets(filters: Ref<ClosedFilters>) {
  const query = computed<TicketListQuery>(() => ({
    status: 'closed',
    limit: CLOSED_PAGE_SIZE,
    ...(filters.value.resolution ? { resolution: filters.value.resolution } : {}),
    ...(filters.value.caseType ? { caseType: filters.value.caseType } : {}),
    ...(filters.value.from ? { from: filters.value.from } : {}),
    ...(filters.value.to ? { to: filters.value.to } : {}),
    ...(filters.value.q ? { q: filters.value.q } : {}),
  }))
  const first = useFetch<TicketListResponse>('/api/tickets', {
    key: CLOSED_LIST_KEY,
    query,
    default: emptyList,
  })
  const more = ref<TicketListItem[]>([])
  const nextCursor = ref<string | null>(null)
  const loadingMore = ref(false)
  watch(
    () => first.data.value,
    (d) => {
      more.value = []
      nextCursor.value = d?.nextCursor ?? null
    },
    { immediate: true },
  )
  const items = computed(() => [...(first.data.value?.items ?? []), ...more.value])
  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const page = await $fetch<TicketListResponse>('/api/tickets', {
        query: { ...query.value, cursor: nextCursor.value },
      })
      const seen = new Set(items.value.map((i) => i.id))
      more.value = [...more.value, ...page.items.filter((i) => !seen.has(i.id))]
      nextCursor.value = page.nextCursor
    } finally {
      loadingMore.value = false
    }
  }
  const result = {
    data: first.data,
    pending: first.pending,
    error: first.error,
    refresh: first.refresh,
    items,
    /** Closed tickets per case under the current filters (IRDR-455). */
    caseCounts: computed(() => first.data.value?.caseCounts ?? {}),
    hasMore: computed(() => nextCursor.value != null),
    loadingMore,
    loadMore,
  }
  await first
  return result
}

export function useTicket(id: Ref<string> | string) {
  const idRef = isRef(id) ? id : ref(id)
  return useFetch<TicketDetailResponse>(() => `/api/tickets/${encodeURIComponent(idRef.value)}`, {
    key: `tickets:${idRef.value}`,
    watch: [idRef],
  })
}

/** Queues a new agent run for every unsent reply draft (inbox 3-dot menu). */
export function regenerateDrafts() {
  return $fetch<RegenerateDraftsResponse>('/api/tickets/regenerate-drafts', { method: 'POST' })
}

/** The decision, agent and learning endpoints for one ticket. Errors are FetchErrors (see classifyActionError). */
export function useTicketActions(ticketId: string) {
  const base = `/api/tickets/${encodeURIComponent(ticketId)}`
  const post = <T>(path: string, body?: Record<string, unknown>) =>
    $fetch<T>(path.startsWith('/') ? path : `${base}/${path}`, {
      method: 'POST',
      body: body ?? {},
    })
  return {
    approve: (body: ApproveRequest) => post<ApproveResponse>('approve', { ...body }),
    reject: (body: RejectRequest) =>
      post<{ decisionId: string; ticketStatus?: string }>('reject', { ...body }),
    manualSend: (body: ManualSendRequest) => post<ApproveResponse>('manual-send', { ...body }),
    snooze: (body: SnoozeRequest) =>
      post<{ ok: true; snoozedUntil?: string }>('snooze', { ...body }),
    unsnooze: () => post<{ ok: true }>('unsnooze'),
    retry: () => post<ApproveResponse>('retry'),
    markDone: (body: MarkDoneRequest) => post<{ ok: true }>('mark-done', { ...body }),
    setCase: (body: SetCaseRequest) => post<{ ok: true }>('case', { ...body }),
    undo: () => post<UndoResponse>('undo'),
    rerun: (body: RerunRequest = {}) => post<{ runId: string }>('rerun', { ...body }),
    consistencyCheck: (body: Omit<ConsistencyCheckRequest, 'ticketId'>) =>
      post<ConsistencyCheckResponse>('/api/agent/consistency-check', { ticketId, ...body }),
    saveExample: () => post<LearningResponse>('/api/learning/example', { ticketId }),
    createKbDraft: () => post<LearningResponse>('/api/learning/kb-draft', { ticketId }),
  }
}

export type TicketActionsApi = ReturnType<typeof useTicketActions>
