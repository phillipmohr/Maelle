<script setup lang="ts">
/** One case type: typical actions, 30 ticks, record line, recommendation with the diamond, Mode. */
import type { AutonomyMode, CaseTrackRecord } from '#shared/api'
import type { ActionType } from '#shared/actions'
import { caseShortLabel } from '#shared/case-types'
import { trackRecordLine } from '#shared/autonomy'

const props = defineProps<{ record: CaseTrackRecord; busy?: boolean }>()
const emit = defineEmits<{ mode: [mode: AutonomyMode] }>()

/** Short action names for the caption, as in the design ("Cancel at period end · Store reason · Send reply"). */
const SHORT: Record<ActionType, string> = {
  cancel_at_period_end: 'Cancel at period end',
  cancel_immediately: 'Cancel immediately',
  refund_latest_payment: 'Refund',
  delete_account: 'Delete account',
  stop_failed_payment_retries: 'Stop retries',
  create_coupon: 'Create coupon',
  create_linear_ticket: 'Create Linear ticket',
  store_release_notification_email: 'Store email',
  store_cancellation_reason: 'Store reason',
  remove_from_tracking: 'Remove from tracking',
  send_reply: 'Send reply',
}

const actions = computed(() =>
  props.record.typicalActions.length
    ? props.record.typicalActions.map((a) => SHORT[a]).join(' · ')
    : 'Reply only',
)
const ready = computed(() => props.record.recommendationKind === 'ready')
</script>

<template>
  <div
    class="grid grid-cols-[minmax(0,1.3fr)_330px_minmax(0,1fr)_260px] items-center gap-5 px-5 py-[14px]"
  >
    <div class="flex min-w-0 flex-col gap-[2px]">
      <span class="text-body font-semibold">{{ caseShortLabel(record.caseType) }}</span>
      <span class="truncate text-caption text-fg-muted">{{ actions }}</span>
    </div>
    <div class="flex flex-col gap-[6px]">
      <AutonomyTicks :ticks="record.ticks" />
      <Mono class="whitespace-nowrap text-[11px]">{{ trackRecordLine(record) }}</Mono>
    </div>
    <div
      class="flex items-center gap-[10px] text-small"
      :class="ready ? 'text-fg' : 'text-fg-muted'"
    >
      <span
        class="size-[7px] shrink-0 rotate-45"
        :class="ready ? 'bg-gilt' : 'bg-umber-700'"
        aria-hidden="true"
      />
      {{ record.recommendation }}
    </div>
    <SegmentedControl
      :model-value="record.mode"
      :disabled="busy"
      :options="[
        { value: 'always_ask', label: 'Always ask' },
        { value: 'auto', label: 'Auto' },
      ]"
      :aria-label="`Mode for ${caseShortLabel(record.caseType)}`"
      @update:model-value="(v) => emit('mode', v as AutonomyMode)"
    />
  </div>
</template>
