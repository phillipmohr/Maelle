<script setup lang="ts">
/** Follow-up and auto-close days, refund limits per day. Number inputs commit on blur or Enter. */
import type { AutonomyUpdateRequest, SettingsRow } from '#shared/api'

type IntKey = 'followUpDays' | 'autoCloseDays' | 'refundDailyLimitCount'

const props = defineProps<{ settings: SettingsRow; busy?: boolean }>()
const emit = defineEmits<{ update: [patch: AutonomyUpdateRequest] }>()

const drafts = reactive({
  followUpDays: String(props.settings.followUpDays),
  autoCloseDays: String(props.settings.autoCloseDays),
  refundDailyLimitCount: String(props.settings.refundDailyLimitCount),
  refundAmount: (props.settings.refundDailyLimitAmountCents / 100).toFixed(2),
})
watch(
  () => props.settings,
  (s) => {
    drafts.followUpDays = String(s.followUpDays)
    drafts.autoCloseDays = String(s.autoCloseDays)
    drafts.refundDailyLimitCount = String(s.refundDailyLimitCount)
    drafts.refundAmount = (s.refundDailyLimitAmountCents / 100).toFixed(2)
  },
)

function commitInt(key: IntKey, min: number, max: number) {
  const n = Math.round(Number(drafts[key]))
  if (!Number.isFinite(n) || n < min || n > max) {
    drafts[key] = String(props.settings[key])
    return
  }
  if (n !== props.settings[key]) emit('update', { settings: { [key]: n } })
  else drafts[key] = String(n)
}
function commitAmount() {
  const dollars = Number(drafts.refundAmount.replace(',', '.'))
  if (!Number.isFinite(dollars) || dollars < 0) {
    drafts.refundAmount = (props.settings.refundDailyLimitAmountCents / 100).toFixed(2)
    return
  }
  const cents = Math.round(dollars * 100)
  if (cents !== props.settings.refundDailyLimitAmountCents) {
    emit('update', { settings: { refundDailyLimitAmountCents: cents } })
  } else drafts.refundAmount = (cents / 100).toFixed(2)
}

const inputClass = 'h-[30px] w-[88px] font-mono text-caption text-right'
</script>

<template>
  <Panel>
    <PanelHeader title="Limits" eyebrow />
    <div class="divide-hairline px-[18px] pb-[18px] pt-4">
      <AutonomySettingRow label="Follow-up" caption="Remind a waiting customer after">
        <Input
          v-model="drafts.followUpDays"
          type="number"
          min="1"
          max="60"
          :disabled="busy"
          :class="inputClass"
          aria-label="Follow-up days"
          @blur="commitInt('followUpDays', 1, 60)"
          @keydown.enter="commitInt('followUpDays', 1, 60)"
        />
        <span class="text-caption text-fg-muted">days</span>
      </AutonomySettingRow>
      <AutonomySettingRow label="Auto-close" caption="Close a waiting ticket without a reply after">
        <Input
          v-model="drafts.autoCloseDays"
          type="number"
          min="1"
          max="90"
          :disabled="busy"
          :class="inputClass"
          aria-label="Auto-close days"
          @blur="commitInt('autoCloseDays', 1, 90)"
          @keydown.enter="commitInt('autoCloseDays', 1, 90)"
        />
        <span class="text-caption text-fg-muted">days</span>
      </AutonomySettingRow>
      <AutonomySettingRow label="Refunds per day" caption="Auto stops refunding beyond this count">
        <Input
          v-model="drafts.refundDailyLimitCount"
          type="number"
          min="0"
          max="1000"
          :disabled="busy"
          :class="inputClass"
          aria-label="Refunds per day"
          @blur="commitInt('refundDailyLimitCount', 0, 1000)"
          @keydown.enter="commitInt('refundDailyLimitCount', 0, 1000)"
        />
        <span class="text-caption text-fg-muted">refunds</span>
      </AutonomySettingRow>
      <AutonomySettingRow label="Refund amount per day" caption="Total Auto may refund per day">
        <span class="text-caption text-fg-muted">$</span>
        <Input
          v-model="drafts.refundAmount"
          type="number"
          min="0"
          step="0.01"
          :disabled="busy"
          :class="inputClass"
          aria-label="Refund amount per day"
          @blur="commitAmount"
          @keydown.enter="commitAmount"
        />
      </AutonomySettingRow>
    </div>
  </Panel>
</template>
