/**
 * The mailbox menu in the inbox header (IRDR-455): live fetch state, "Fetch now", the history
 * import with its progress, and the classify-only pass over imported tickets. Polls while an
 * import or a classification run is active.
 */
import type {
  MailBackfillProgress,
  MailClassifyImportedResponse,
  MailFetchResponse,
  MailImportResponse,
  MailStatusResponse,
} from '#shared/api'
import { CLOSED_LIST_KEY, TICKET_LIST_KEY } from '~/composables/useTickets'

export const MAIL_STATUS_KEY = 'mail:status'
const POLL_MS = 5_000

export function folderLabel(folder: MailBackfillProgress['folder']): string {
  return folder === 'inbox' ? 'Inbox' : 'Sent'
}

/** "Inbox · 120 of 642 · 98 imported, 20 skipped, 2 ignored" */
export function folderLine(f: MailBackfillProgress): string {
  const pos =
    f.maxUid != null && f.maxUid > 0
      ? `${Math.min(f.lastUid ?? 0, f.maxUid)} of ${f.maxUid}`
      : f.status === 'queued'
        ? 'queued'
        : 'empty'
  const parts = [`${f.imported} imported`]
  if (f.skipped) parts.push(`${f.skipped} already known`)
  if (f.ignored) parts.push(`${f.ignored} ignored`)
  if (f.failed) parts.push(`${f.failed} failed`)
  const state = f.status === 'done' ? 'done' : f.status === 'failed' ? 'failed' : pos
  return `${folderLabel(f.folder)} · ${state} · ${parts.join(', ')}`
}

export function classifyLine(c: MailStatusResponse['classify']): string {
  if (c.imported === 0) return 'No imported tickets yet'
  const parts = [`${c.classified} of ${c.imported} classified`]
  if (c.pending) parts.push(c.active ? `${c.pending} in progress` : `${c.pending} waiting`)
  if (c.failed) parts.push(`${c.failed} without a case`)
  return parts.join(' · ')
}

/** "0 new · 2 already known" from mail_cursors.last_result. */
export function fetchResultLine(r: Record<string, unknown> | null): string {
  if (!r) return 'not run yet'
  const n = (k: string) => Number(r[k] ?? 0)
  const parts = [`${n('ingested')} new`]
  if (n('skipped')) parts.push(`${n('skipped')} already known`)
  if (n('ignored')) parts.push(`${n('ignored')} ignored`)
  if (n('failed')) parts.push(`${n('failed')} failed`)
  return parts.join(' · ')
}

export function useMailStatus() {
  const { data, refresh, pending, error } = useFetch<MailStatusResponse>('/api/mail/status', {
    key: MAIL_STATUS_KEY,
    lazy: true,
    server: false,
  })
  const busy = ref<'fetch' | 'import' | 'classify' | null>(null)
  const active = computed(
    () => Boolean(data.value?.backfill.active) || Boolean(data.value?.classify.active),
  )

  let timer: ReturnType<typeof setTimeout> | null = null
  function stopPolling() {
    if (timer) clearTimeout(timer)
    timer = null
  }
  function poll() {
    stopPolling()
    if (!active.value) return
    timer = setTimeout(async () => {
      await refresh().catch(() => {})
      await refreshNuxtData([TICKET_LIST_KEY, CLOSED_LIST_KEY]).catch(() => {})
      poll()
    }, POLL_MS)
  }
  watch(active, (a) => (a ? poll() : stopPolling()), { immediate: true })
  onBeforeUnmount(stopPolling)

  async function run<T>(kind: NonNullable<typeof busy.value>, fn: () => Promise<T>): Promise<T> {
    busy.value = kind
    try {
      return await fn()
    } finally {
      busy.value = null
      await refresh().catch(() => {})
    }
  }

  return {
    data,
    pending,
    error,
    busy,
    active,
    refresh,
    fetchNow: () =>
      run('fetch', async () => {
        const r = await $fetch<MailFetchResponse>('/api/mail/fetch', { method: 'POST' })
        await refreshNuxtData([TICKET_LIST_KEY, CLOSED_LIST_KEY]).catch(() => {})
        return r
      }),
    importHistory: () =>
      run('import', async () => {
        const r = await $fetch<MailImportResponse>('/api/mail/import', { method: 'POST' })
        data.value = r.status
        return r
      }),
    classifyImported: () =>
      run('classify', async () => {
        const r = await $fetch<MailClassifyImportedResponse>('/api/mail/classify-imported', {
          method: 'POST',
        })
        data.value = r.status
        return r
      }),
  }
}
