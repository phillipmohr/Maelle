<script setup lang="ts">
/**
 * Mailbox popover in the inbox header: when the live fetch last ran and what it found,
 * "Fetch now", "Import history" (every old mail from INBOX and Sent as closed tickets) with its
 * progress, and the classify-only pass that gives imported tickets a case.
 */
import { CLOSED_LIST_KEY, TICKET_LIST_KEY } from '~/composables/useTickets'
import { classifyLine, fetchResultLine, folderLine, useMailStatus } from '~/composables/useMailbox'
import { useToast } from '~/composables/useToast'
import { ageShort } from '~/utils/format'

const open = ref(false)
const { data, busy, active, refresh, fetchNow, importHistory, classifyImported } = useMailStatus()
const toast = useToast()

watch(open, (o) => {
  if (o) refresh().catch(() => {})
})

const provider = computed(() =>
  data.value?.provider === 'imap' ? data.value.mailbox : 'fake mailbox (no MAIL_PASSWORD)',
)
const lastFetch = computed(() => {
  const f = data.value?.fetch
  if (!f) return '…'
  const when = f.lastAt ? ageShort(f.lastAt, new Date()) : 'never'
  return `${when} · ${fetchResultLine(f.lastResult)}`
})
const importDone = computed(
  () =>
    (data.value?.backfill.folders.length ?? 0) > 0 &&
    data.value!.backfill.folders.every((f) => f.status === 'done'),
)
const importLabel = computed(() =>
  active.value && data.value?.backfill.active
    ? 'Importing…'
    : importDone.value
      ? 'Import again'
      : 'Import history',
)

function errorMessage(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string; message?: string }
  return err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Unknown error'
}

async function onFetch() {
  try {
    const r = await fetchNow()
    toast.info(
      `Fetched · ${r.ingested} new`,
      [
        r.ticketsCreated ? `${r.ticketsCreated} new tickets` : null,
        r.skipped ? `${r.skipped} already known` : null,
        r.ignored ? `${r.ignored} ignored` : null,
        r.failed ? `${r.failed} failed` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing new in the mailbox',
    )
  } catch (e) {
    toast.error('Fetch failed', errorMessage(e))
  }
}
async function onImport() {
  try {
    const r = await importHistory()
    if (r.started) {
      toast.info(
        'Import queued',
        'Old mail arrives in the closed list over the next minutes. Tickets are classified afterwards.',
      )
    } else toast.info('Import already running')
    await refreshNuxtData([TICKET_LIST_KEY, CLOSED_LIST_KEY]).catch(() => {})
  } catch (e) {
    toast.error('Import did not start', errorMessage(e))
  }
}
async function onClassify() {
  try {
    const r = await classifyImported()
    if (r.started) toast.info('Classification queued', 'Imported tickets get their case shortly.')
    else toast.info('Nothing to classify', r.reason ?? undefined)
  } catch (e) {
    toast.error('Classification did not start', errorMessage(e))
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex items-center gap-2 rounded-md border border-line px-[10px] py-2 text-small text-fg-muted transition-fast hover:border-line-strong hover:text-fg"
        aria-label="Mailbox"
      >
        <span
          class="size-[6px] rounded-full"
          :class="active ? 'bg-slate-blue' : data?.fetch.lastAt ? 'bg-sage' : 'bg-sand'"
          aria-hidden="true"
        />
        <span>Mailbox</span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-[440px]">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <Eyebrow>Mailbox</Eyebrow>
          <Mono class="text-[11px]">{{ provider }}</Mono>
        </div>

        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-small font-semibold">Live fetch</span>
            <span class="text-caption text-fg-muted">
              Runs every minute · last {{ lastFetch }}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy != null"
            :loading="busy === 'fetch'"
            @click="onFetch"
            >{{ busy === 'fetch' ? 'Fetching…' : 'Fetch now' }}</Button
          >
        </div>

        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-small font-semibold">History</span>
            <span class="text-caption text-fg-muted [text-wrap:pretty]">
              Every old mail from Inbox and Sent, as closed tickets. No replies are sent, no agent
              runs.
            </span>
            <template v-if="data && data.backfill.folders.length > 0">
              <span
                v-for="f in data.backfill.folders"
                :key="f.folder"
                class="text-caption"
                :class="f.status === 'failed' ? 'text-brick' : 'text-fg-muted'"
                >{{ folderLine(f) }}</span
              >
              <span
                v-if="data.backfill.folders.some((f) => f.lastError)"
                class="truncate text-[11px] text-fg-muted"
                :title="data.backfill.folders.find((f) => f.lastError)?.lastError ?? ''"
                >Last error: {{ data.backfill.folders.find((f) => f.lastError)?.lastError }}</span
              >
            </template>
          </div>
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy != null || Boolean(data?.backfill.active)"
            :loading="busy === 'import'"
            @click="onImport"
            >{{ importLabel }}</Button
          >
        </div>

        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-small font-semibold">Cases for imported tickets</span>
            <span class="text-caption text-fg-muted">{{
              data ? classifyLine(data.classify) : '…'
            }}</span>
            <span v-if="data?.classify.blocked" class="text-caption text-ember">{{
              data.classify.blocked
            }}</span>
            <span
              v-else-if="data?.classify.lastError && data.classify.failed"
              class="truncate text-[11px] text-fg-muted"
              :title="data.classify.lastError"
              >Last error: {{ data.classify.lastError }}</span
            >
          </div>
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy != null || !data || data.classify.pending === 0 || data.classify.active"
            :loading="busy === 'classify'"
            @click="onClassify"
            >{{ data?.classify.active ? 'Classifying…' : 'Classify' }}</Button
          >
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
