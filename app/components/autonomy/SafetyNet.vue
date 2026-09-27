<script setup lang="ts">
/**
 * "Safety net for Auto": undo window, daily digest time, timezone, notify email. Each control saves
 * on change; the parent does the PUT and the toast.
 */
import type { AutonomyUpdateRequest, SettingsRow } from '#shared/api'
import { UNDO_WINDOW_OPTIONS } from '#shared/autonomy'

const props = defineProps<{ settings: SettingsRow; busy?: boolean }>()
const emit = defineEmits<{ update: [patch: AutonomyUpdateRequest] }>()

const TIMEZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Lisbon',
  'Europe/Stockholm',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]
const timezones = computed(() =>
  TIMEZONES.includes(props.settings.timezone) ? TIMEZONES : [props.settings.timezone, ...TIMEZONES],
)

const digestTime = ref(props.settings.digestTime)
const notifyEmail = ref(props.settings.notifyEmail ?? '')
watch(
  () => props.settings,
  (s) => {
    digestTime.value = s.digestTime
    notifyEmail.value = s.notifyEmail ?? ''
  },
)

function setUndoWindow(v: string) {
  const minutes = Number(v) as 5 | 10 | 15
  if (minutes !== props.settings.undoWindowMinutes)
    emit('update', { settings: { undoWindowMinutes: minutes } })
}
function commitDigestTime() {
  const raw = digestTime.value.trim()
  const v = /^\d:\d{2}$/.test(raw) ? `0${raw}` : raw.slice(0, 5)
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && v !== props.settings.digestTime) {
    emit('update', { settings: { digestTime: v } })
  } else {
    digestTime.value = props.settings.digestTime
  }
}
function setTimezone(e: Event) {
  const tz = (e.target as HTMLSelectElement).value
  if (tz && tz !== props.settings.timezone) emit('update', { settings: { timezone: tz } })
}
function commitNotifyEmail() {
  const v = notifyEmail.value.trim()
  if (v === (props.settings.notifyEmail ?? '')) return
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    notifyEmail.value = props.settings.notifyEmail ?? ''
    return
  }
  emit('update', { settings: { notifyEmail: v || null } })
}
</script>

<template>
  <Panel>
    <PanelHeader title="Safety net for Auto" eyebrow />
    <div class="divide-hairline px-[18px] pb-[18px] pt-4">
      <AutonomySettingRow label="Undo window" caption="Auto replies wait before sending">
        <SegmentedControl
          :model-value="String(settings.undoWindowMinutes)"
          mono
          :disabled="busy"
          :options="UNDO_WINDOW_OPTIONS.map((m) => ({ value: String(m), label: `${m} min` }))"
          aria-label="Undo window"
          @update:model-value="setUndoWindow"
        />
      </AutonomySettingRow>
      <AutonomySettingRow label="Daily digest" caption="Everything handled automatically">
        <Input
          v-model="digestTime"
          inputmode="numeric"
          placeholder="08:00"
          :disabled="busy"
          aria-label="Daily digest time"
          class="h-[30px] w-[72px] text-center font-mono text-caption"
          @blur="commitDigestTime"
          @keydown.enter="commitDigestTime"
        />
      </AutonomySettingRow>
      <AutonomySettingRow label="Timezone" caption="For the digest, follow-ups and snoozes">
        <select
          :value="settings.timezone"
          :disabled="busy"
          aria-label="Timezone"
          class="h-[30px] max-w-[220px] rounded-md border border-line bg-inset px-2 font-mono text-caption text-fg outline-none transition-fast [transition-property:border-color] focus:border-line-strong disabled:opacity-45"
          @change="setTimezone"
        >
          <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
        </select>
      </AutonomySettingRow>
      <AutonomySettingRow label="Notify email" caption="High-risk alerts and the digest go here">
        <Input
          v-model="notifyEmail"
          type="email"
          placeholder="NOTIFY_EMAIL from .env"
          :disabled="busy"
          class="h-[30px] w-[220px] font-mono text-caption"
          @blur="commitNotifyEmail"
          @keydown.enter="commitNotifyEmail"
        />
      </AutonomySettingRow>
    </div>
  </Panel>
</template>
