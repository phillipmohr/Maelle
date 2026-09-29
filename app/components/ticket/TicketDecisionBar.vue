<script setup lang="ts">
/**
 * The sticky decision bar. Normal: primary (A), Edit (E), Reject (R), Snooze (S) and a note.
 * Confirm (ember): "Press A again to run N irreversible actions", the effects, Back (Esc),
 * Confirm & execute (A). Failed: Retry (⏎), Mark as done manually, View log. Plus the parked,
 * researching, unclear, manual, auto and closed variants. A closed ticket can be re-opened: the
 * agent reads the whole thread again (the last customer message included) and drafts a reply.
 */
import type { DecisionPhase, DecisionView } from '~/composables/useTicketDecision'

defineProps<{
  view: DecisionView
  phase: DecisionPhase
  primary: string
  note: string
  confirmText: string
  confirmCount: number
  busy: boolean
  canSnooze: boolean
}>()
const emit = defineEmits<{
  approve: []
  back: []
  edit: []
  reject: []
  snooze: []
  retry: []
  markDone: []
  viewLog: []
  unsnooze: []
  undo: []
  rerun: []
  pickCase: []
  send: []
  toInbox: []
}>()
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 border-t px-8 py-[14px]"
    :class="
      view === 'decide' && phase === 'confirm'
        ? 'border-ember/33 bg-ember/8'
        : 'border-line bg-base'
    "
    role="toolbar"
    aria-label="Decision"
  >
    <template v-if="view === 'decide' && phase === 'confirm'">
      <div class="flex flex-col gap-[3px]">
        <span class="flex items-center gap-2 text-body font-semibold text-ember"
          ><LockShape size="md" />Press A again to run {{ confirmCount }} irreversible
          {{ confirmCount === 1 ? 'action' : 'actions' }}</span
        >
        <span class="text-caption text-fg-muted">{{ confirmText }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="ghost" kbd="Esc" @click="emit('back')">Back</Button>
        <Button kbd="A" :loading="busy" @click="emit('approve')">Confirm &amp; execute</Button>
      </div>
    </template>

    <template v-else-if="view === 'decide'">
      <div class="flex items-center gap-2">
        <Button kbd="A" :loading="busy || phase === 'submitting'" @click="emit('approve')">{{
          primary
        }}</Button>
        <Button variant="secondary" kbd="E" @click="emit('edit')">Edit</Button>
        <Button variant="ghost" kbd="R" @click="emit('reject')">Reject</Button>
        <Button v-if="canSnooze" variant="ghost" kbd="S" @click="emit('snooze')">Snooze</Button>
      </div>
      <span class="shrink-0 text-right text-caption text-fg-muted">{{ note }}</span>
    </template>

    <template v-else-if="view === 'executing'">
      <div class="flex items-center gap-2">
        <Button loading disabled>Executing</Button>
      </div>
      <span class="text-right text-caption text-fg-muted"
        >Each action reports back as it runs · nothing irreversible happens quietly</span
      >
    </template>

    <template v-else-if="view === 'failed'">
      <div class="flex items-center gap-2">
        <Button kbd="⏎" :loading="busy" @click="emit('retry')">Retry failed action</Button>
        <Button variant="secondary" kbd="M" @click="emit('markDone')">Mark as done manually</Button>
        <Button variant="ghost" @click="emit('viewLog')">View log</Button>
      </div>
      <span class="shrink-0 text-right text-caption text-fg-muted">{{ note }}</span>
    </template>

    <template v-else-if="view === 'manual'">
      <div class="flex items-center gap-2">
        <Button kbd="⌘⏎" :loading="busy" @click="emit('send')">Send reply</Button>
        <Button variant="secondary" kbd="M" @click="emit('markDone')">Mark as done</Button>
      </div>
      <span class="text-right text-caption text-fg-muted"
        >Written by you · the actions you picked run before the reply</span
      >
    </template>

    <template v-else-if="view === 'waiting'">
      <div class="flex items-center gap-2">
        <Button variant="secondary" kbd="M" @click="emit('markDone')">Mark as done manually</Button>
        <Button variant="ghost" @click="emit('rerun')">Re-run research</Button>
      </div>
      <span class="text-right text-caption text-fg-muted">{{ note }}</span>
    </template>

    <template v-else-if="view === 'snoozed'">
      <div class="flex items-center gap-2">
        <Button kbd="S" :loading="busy" @click="emit('unsnooze')">Unsnooze</Button>
      </div>
      <span class="text-right text-caption text-fg-muted">{{ note }}</span>
    </template>

    <template v-else-if="view === 'auto'">
      <div class="flex items-center gap-2">
        <Button :loading="busy" @click="emit('undo')">Undo</Button>
      </div>
      <span class="text-right text-caption text-fg-muted"
        >Handled automatically · the reply waits for the undo window</span
      >
    </template>

    <template v-else-if="view === 'researching'">
      <div class="flex items-center gap-2">
        <Button variant="secondary" @click="emit('pickCase')">Change case</Button>
        <Button variant="ghost" @click="emit('rerun')">Re-run research</Button>
      </div>
      <span class="text-right text-caption text-fg-muted"
        >AnastasAI is researching · the proposal appears here without a reload</span
      >
    </template>

    <template v-else-if="view === 'unclear'">
      <div class="flex items-center gap-2">
        <Button kbd="⏎" @click="emit('pickCase')">Pick the case</Button>
        <Button v-if="canSnooze" variant="ghost" kbd="S" @click="emit('snooze')">Snooze</Button>
      </div>
      <span class="text-right text-caption text-fg-muted"
        >Classification was unsure · pick from the candidates and the research runs again</span
      >
    </template>

    <template v-else-if="view === 'closed'">
      <div class="flex items-center gap-2">
        <Button variant="secondary" :loading="busy" @click="emit('rerun')"
          >Re-open and draft a reply</Button
        >
        <Button variant="ghost" kbd="Esc" @click="emit('toInbox')">Back to the inbox</Button>
      </div>
      <span class="text-right text-caption text-fg-muted">{{ note }}</span>
    </template>

    <template v-else>
      <span class="text-caption text-fg-muted">Loading…</span>
    </template>
  </div>
</template>
