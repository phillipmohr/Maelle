<script setup lang="ts">
/**
 * Manual mode after a reject: an empty reply editor and actions picked from the registry, then
 * send (⌘⏎). Handled manually = "I’ll handle it": the reply goes out, the ticket closes as handled.
 */
import { ACTIONS, ACTION_TYPES, type ActionType } from '#shared/actions'
import type { TicketRow } from '#shared/api'
import { MAILBOX } from '#shared/config'
import { paramsProblem } from '~/composables/useTicketParams'
import { paramsSummary } from '~/composables/useTicketModel'

const signature = MAILBOX.signature

const props = defineProps<{ ticket: TicketRow; busy: boolean; handledManually: boolean }>()
const emit = defineEmits<{
  send: [
    input: {
      body: string
      subject: string
      actions: { type: ActionType; params: Record<string, unknown> }[]
      handledManually: boolean
    },
  ]
}>()

const subject = ref(`Re: ${props.ticket.subject ?? ''}`.trim())
const body = ref('')
const picked = ref<{ type: ActionType; params: Record<string, unknown> }[]>([])
const editor = ref<{ $el?: HTMLTextAreaElement } | HTMLTextAreaElement | null>(null)

const available = computed(() =>
  ACTION_TYPES.filter((t) => t !== 'send_reply' && !picked.value.some((p) => p.type === t)).sort(
    (a, b) => ACTIONS[a].order - ACTIONS[b].order,
  ),
)
function defaults(type: ActionType): Record<string, unknown> {
  const t = props.ticket
  switch (type) {
    case 'store_release_notification_email':
      return { email: t.customerEmail }
    case 'create_linear_ticket':
      return {
        title: t.subject ?? '',
        description: '',
        label: 'Bug',
        customerEmail: t.customerEmail,
      }
    case 'delete_account':
      return { instaradarUserId: t.instaradarUserId ?? '', email: t.customerEmail }
    case 'stop_failed_payment_retries':
      return { stripeCustomerId: t.stripeCustomerId ?? '' }
    case 'store_cancellation_reason':
      return {
        stripeCustomerId: t.stripeCustomerId ?? '',
        feedback: 'other',
        comment: 'Not stated',
      }
    case 'create_coupon':
      return {
        kind: 'percent',
        percentOff: 20,
        duration: 'once',
        applyTo: 'subscription',
        stripeCustomerId: t.stripeCustomerId ?? '',
      }
    case 'refund_latest_payment':
      return { amountCents: 0, currency: 'usd', reason: 'requested_by_customer' }
    default:
      return {}
  }
}
function add(type: ActionType) {
  picked.value = [...picked.value, { type, params: defaults(type) }].sort(
    (a, b) => ACTIONS[a.type].order - ACTIONS[b.type].order,
  )
}
function remove(type: ActionType) {
  picked.value = picked.value.filter((p) => p.type !== type)
}
function setParams(type: ActionType, params: Record<string, unknown>) {
  picked.value = picked.value.map((p) => (p.type === type ? { ...p, params } : p))
}
const problems = computed(() =>
  picked.value.map((p) => paramsProblem(p.type, p.params)).filter(Boolean),
)
const canSend = computed(
  () => body.value.trim().length > 0 && problems.value.length === 0 && !props.busy,
)

function submit() {
  if (!canSend.value) return
  emit('send', {
    body: body.value,
    subject: subject.value,
    actions: picked.value,
    handledManually: props.handledManually,
  })
}
onMounted(() => {
  const el =
    (editor.value as { $el?: HTMLTextAreaElement } | null)?.$el ??
    (editor.value as HTMLTextAreaElement | null)
  el?.focus?.()
})
defineExpose({ submit, canSend })
</script>

<template>
  <section class="flex flex-col gap-[10px]" aria-label="Your reply">
    <div class="flex items-baseline justify-between gap-3">
      <Eyebrow as="h2">Your reply</Eyebrow>
      <Mono class="text-[11px]"
        >written by you ·
        {{ handledManually ? 'handled manually' : 'after rejecting the proposal' }}</Mono
      >
    </div>
    <div class="flex flex-col overflow-hidden rounded-md border border-line-strong bg-base">
      <div
        class="flex items-center justify-between gap-3 border-b border-line px-[18px] py-[10px] font-mono text-[11px] text-fg-muted"
      >
        <span class="truncate">support@instaradar.app → {{ ticket.customerEmail }}</span>
        <span class="flex items-center gap-[6px]">Send <Kbd keys="⌘⏎" /></span>
      </div>
      <div class="flex flex-col gap-3 px-[18px] pb-[18px] pt-4">
        <label class="flex flex-col gap-1 text-caption text-fg-muted"
          >Subject <Input v-model="subject"
        /></label>
        <Textarea
          ref="editor"
          v-model="body"
          :rows="10"
          placeholder="Hi …"
          aria-label="Reply body"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
      </div>
      <div
        class="flex flex-col gap-1 border-t border-line px-[18px] py-3 text-caption leading-[1.5] text-fg-muted"
        aria-label="Signature"
      >
        <p class="whitespace-pre-line">{{ signature }}</p>
        <Mono class="text-[11px]">Signature · added when the reply is sent</Mono>
      </div>
    </div>

    <Panel>
      <PanelHeader title="Actions" :meta="`${picked.length} picked`" eyebrow />
      <div class="divide-hairline">
        <div v-for="p in picked" :key="p.type" class="flex flex-col gap-1 px-[18px] py-[13px]">
          <div class="flex flex-wrap items-baseline gap-[10px]">
            <span
              class="flex items-center gap-2 text-body font-semibold"
              :class="ACTIONS[p.type].irreversible ? 'text-ember' : 'text-fg'"
              ><LockShape v-if="ACTIONS[p.type].irreversible" />{{ ACTIONS[p.type].label }}</span
            >
            <Mono>{{ paramsSummary(p) }}</Mono>
            <button
              type="button"
              class="text-caption font-semibold text-fg-muted hover:text-brick"
              @click="remove(p.type)"
            >
              Remove
            </button>
          </div>
          <TicketParamEditor
            :type="p.type"
            :params="p.params"
            @update:params="(v) => setParams(p.type, v)"
          />
        </div>
        <p v-if="picked.length === 0" class="px-[18px] py-[13px] text-caption text-fg-muted">
          No actions · only the reply goes out.
        </p>
      </div>
      <div class="border-t border-line">
        <TicketAddAction :available="available" @add="add" />
      </div>
    </Panel>
  </section>
</template>
