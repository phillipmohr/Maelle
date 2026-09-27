<script setup lang="ts">
/** Waiting on customer / Snoozed: what we wait for, the queued actions, the return time. */
import type { TicketRow } from '#shared/api'
import { ACTIONS } from '#shared/actions'
import { returnLabel } from '~/composables/useInboxRows'
import { queuedActions, type EditableAction } from '~/composables/useTicketModel'
import { shortDate } from '~/utils/format'

const props = defineProps<{ ticket: TicketRow; actions: EditableAction[]; now: Date }>()
const queued = computed(() => queuedActions(props.actions))
const eyebrow = computed(() =>
  props.ticket.status === 'snoozed' ? 'Snoozed' : 'Waiting on customer',
)
const text = computed(() => {
  const t = props.ticket
  if (t.status === 'snoozed')
    return `Returns ${returnLabel(t.snoozedUntil, props.now)}. Unsnooze to decide now.`
  const what = t.waitingFor ? `Waiting for “${t.waitingFor}”` : 'Waiting for the customer to reply'
  const since = shortDate(t.lastMessageAt ?? t.updatedAt, props.now)
  const q = queued.value.length
    ? ` ${queued.value.length === 1 ? '1 action waits' : `${queued.value.length} actions wait`} for the confirmation: ${queued.value.map((a) => ACTIONS[a.type].label.toLowerCase()).join(', ')}.`
    : ''
  return `${what} since ${since}.${q} A reply brings the ticket back with the research updated.`
})
</script>

<template>
  <RiskBanner level="info" :eyebrow="eyebrow">{{ text }}</RiskBanner>
</template>
