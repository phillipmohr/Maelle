<script setup lang="ts">
/** Reject: reason picker (1 to 4), then the ticket goes to manual mode. */
import type { RejectReason } from '#shared/services'
import { useShortcuts } from '~/composables/useShortcuts'

const emit = defineEmits<{ pick: [reason: RejectReason] }>()
const open = defineModel<boolean>('open', { default: false })

const REASONS: { value: RejectReason; label: string; hint: string }[] = [
  {
    value: 'wrong_case',
    label: 'Wrong case',
    hint: 'The template does not fit what the customer wrote.',
  },
  {
    value: 'wrong_actions',
    label: 'Wrong actions',
    hint: 'The reply may be fine, the actions are not.',
  },
  { value: 'wrong_tone', label: 'Wrong tone', hint: 'Right actions, the wording needs to change.' },
  {
    value: 'handle_myself',
    label: 'I’ll handle it',
    hint: 'Set the proposal aside and take it from here.',
  },
]

function pick(r: RejectReason) {
  open.value = false
  emit('pick', r)
}

const { register } = useShortcuts()
register(
  REASONS.map((r, i) => ({
    id: `ticket.reject.${r.value}`,
    keys: String(i + 1),
    label: `Reject · ${r.label}`,
    group: 'Decision',
    scope: 'ticket',
    hidden: true,
    when: () => open.value,
    handler: () => pick(r.value),
  })),
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :width="520">
      <DialogHeader>
        <Eyebrow tone="accent">Reject</Eyebrow>
        <DialogTitle>Why does this proposal not fit?</DialogTitle>
        <DialogDescription
          >You write the reply yourself afterwards. The reason trains the next
          proposal.</DialogDescription
        >
      </DialogHeader>
      <div class="mt-5 flex flex-col gap-2">
        <button
          v-for="(r, i) in REASONS"
          :key="r.value"
          type="button"
          class="flex items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left transition-fast hover:border-line-strong"
          @click="pick(r.value)"
        >
          <span class="flex flex-col gap-px">
            <span class="text-body font-semibold">{{ r.label }}</span>
            <span class="text-caption text-fg-muted">{{ r.hint }}</span>
          </span>
          <Kbd :keys="String(i + 1)" />
        </button>
      </div>
      <DialogFooter>
        <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
