<script setup lang="ts">
/**
 * One row of the activity log: Time, Action (lock shape before irreversible names, ember), Parameters,
 * Ticket, By, Result pill; the error line in brick under failed rows. Executions link to the ticket,
 * settings changes to the Autonomy page.
 */
import type { ActivityItem, SettingsAuditItem } from '#shared/api'
import { actionLabel } from '#shared/actions'
import { describeExecution, executionResultLabel } from '#shared/activity'
import { clockTime } from '~/utils/format'

export type ActivityEntry =
  | { kind: 'execution'; at: string; id: string; item: ActivityItem }
  | { kind: 'settings'; at: string; id: string; item: SettingsAuditItem }

const props = defineProps<{ entry: ActivityEntry }>()

const execution = computed(() => (props.entry.kind === 'execution' ? props.entry.item : null))
const result = computed(() => (execution.value ? executionResultLabel(execution.value) : null))
const params = computed(() => (execution.value ? describeExecution(execution.value) : ''))
const to = computed(() =>
  execution.value ? `/anastasai/t/${execution.value.ticketDisplayNumber}` : '/anastasai/autonomy',
)
</script>

<template>
  <NuxtLink
    :to="to"
    class="grid grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1.3fr)_70px_80px_120px] items-center gap-x-[18px] gap-y-[6px] border-t border-line px-5 py-[11px] text-fg no-underline transition-fast [transition-property:background-color] hover:bg-elevated/50 hover:no-underline"
  >
    <Mono>{{ clockTime(entry.at) }}</Mono>

    <template v-if="execution && result">
      <span
        class="flex min-w-0 items-center text-body font-semibold"
        :class="execution.irreversible ? 'text-ember' : 'text-fg'"
        ><LockShape v-if="execution.irreversible" class="mr-[6px]" /><span class="truncate">{{
          actionLabel(execution.type)
        }}</span></span
      >
      <Mono class="truncate" :title="params">{{ params }}</Mono>
      <Mono>#{{ execution.ticketDisplayNumber }}</Mono>
      <span class="flex items-center gap-2 text-small"
        ><RiskDot v-if="execution.executedBy === 'auto'" kind="auto" />{{
          execution.executedBy === 'auto' ? 'Auto' : 'You'
        }}</span
      >
      <div>
        <StatusPill :status="result.tone">{{ result.label }}</StatusPill>
      </div>
      <span
        v-if="execution.error"
        class="col-start-2 col-end-7 font-mono text-[11.5px] leading-[1.45] text-brick"
        >{{ execution.error }}</span
      >
    </template>

    <template v-else-if="entry.kind === 'settings'">
      <span class="flex items-center text-body font-semibold text-fg"
        ><span
          class="mr-[6px] size-[7px] rounded-[1px] border-[1.5px] border-sand"
          aria-hidden="true"
        />Settings</span
      >
      <Mono class="truncate" :title="entry.item.summary">{{ entry.item.summary }}</Mono>
      <span />
      <span class="text-small">You</span>
      <div><StatusPill status="neutral" :dot="false">Changed</StatusPill></div>
    </template>
  </NuxtLink>
</template>
