<script setup lang="ts">
/** A closed ticket, read only: the decision, what ran, the sent reply. The audit trail follows. */
import type { TicketDetailResponse } from '#shared/api'
import { decisionPill } from '~/composables/useInboxRows'
import { outcomeLines } from '~/composables/useTicketModel'
import { clockTime, shortDate } from '~/utils/format'

const props = defineProps<{ detail: TicketDetailResponse; now: Date }>()
const ticket = computed(() => props.detail.ticket)
const decision = computed(() => props.detail.decisions[0] ?? null)
const pill = computed(() =>
  decisionPill({ resolution: ticket.value.resolution, decision: decision.value?.decision ?? null }),
)
const ran = computed(() => outcomeLines(props.detail))
const sent = computed(
  () =>
    [...props.detail.messages]
      .filter((m) => m.direction === 'out')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
)
function paragraphs(s: string | null): string[] {
  return (s ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}
</script>

<template>
  <Panel elevation="focus" :padding="24" as="section" aria-label="Outcome">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <Eyebrow tone="accent" as="h2">Outcome</Eyebrow>
        <Mono class="text-[11px]"
          >Closed
          {{
            ticket.closedAt
              ? `${shortDate(ticket.closedAt, now)} · ${clockTime(ticket.closedAt)}`
              : ''
          }}</Mono
        >
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <StatusPill v-if="pill.kind === 'pill'" :status="pill.status" :dot="pill.dot">{{
          pill.label
        }}</StatusPill>
        <span
          v-else
          class="rounded-pill border border-line px-[9px] py-[2px] text-caption font-semibold text-fg-muted"
          >{{ pill.label }}</span
        >
        <span v-if="decision?.note" class="text-caption text-fg-muted">{{ decision.note }}</span>
      </div>
      <p class="font-serif text-heading leading-[1.2] text-fg [text-wrap:pretty]">
        {{ ran.length ? ran.join(', ') + '.' : 'Nothing ran.' }}
      </p>
      <Provenance>Read only · every step is in the audit trail below</Provenance>
    </div>
  </Panel>
  <section v-if="sent" class="flex flex-col gap-[10px]" aria-label="Sent reply">
    <div class="flex items-baseline justify-between gap-3">
      <Eyebrow as="h2">Sent reply</Eyebrow>
      <Mono class="text-[11px]"
        >{{ sent.sentBy === 'auto' ? 'Auto' : 'You' }} ·
        {{ sent.sentAt ? `${shortDate(sent.sentAt, now)} ${clockTime(sent.sentAt)}` : '' }}</Mono
      >
    </div>
    <div class="flex flex-col overflow-hidden rounded-md border border-line bg-base">
      <div
        class="flex justify-between border-b border-line px-[18px] py-[10px] font-mono text-[11px] text-fg-muted"
      >
        <span>{{ sent.fromEmail }} → {{ sent.toEmails[0] ?? ticket.customerEmail }}</span
        ><span>{{ sent.subject }}</span>
      </div>
      <div class="flex flex-col gap-3 px-[18px] pb-[18px] pt-4 text-body leading-[1.6]">
        <p
          v-for="(p, i) in paragraphs(sent.textBody)"
          :key="i"
          class="whitespace-pre-line [text-wrap:pretty]"
        >
          {{ p }}
        </p>
      </div>
    </div>
  </section>
</template>
