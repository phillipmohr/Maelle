<script setup lang="ts">
/** Proposed actions panel: "N of 11", one TicketActionRow per action, the add-action footer. */
import type { ActionExecutionRow } from '#shared/api'
import { ACTION_TOTAL, type ActionType } from '#shared/actions'
import type { ExecutionSummary } from '#shared/services'
import { actionState, type EditableAction } from '~/composables/useTicketModel'

const props = defineProps<{
  actions: EditableAction[]
  executions: ActionExecutionRow[]
  liveExecutions: ExecutionSummary[]
  proposalId: string | null
  editable: boolean
  attachments: number
  available: ActionType[]
  metaLine?: string | null
}>()
const emit = defineEmits<{
  setEnabled: [key: string, enabled: boolean]
  setParams: [key: string, params: Record<string, unknown>]
  add: [type: ActionType]
  remove: [key: string]
}>()

function live(a: EditableAction): ExecutionSummary | null {
  return props.liveExecutions.find((e) => e.type === a.type) ?? null
}
const meta = computed(() => props.metaLine ?? `${props.actions.length} of ${ACTION_TOTAL}`)
</script>

<template>
  <Panel as="section" aria-label="Proposed actions">
    <PanelHeader title="Proposed actions" :meta="meta" eyebrow />
    <div class="divide-hairline">
      <TicketActionRow
        v-for="a in actions"
        :key="a.key"
        :action="a"
        :state="actionState(a, executions, proposalId, live(a))"
        :editable="editable"
        :attachments="a.type === 'send_reply' ? attachments : 0"
        @update:enabled="(v) => emit('setEnabled', a.key, v)"
        @update:params="(p) => emit('setParams', a.key, p)"
        @remove="emit('remove', a.key)"
      />
    </div>
    <div class="border-t border-line">
      <TicketAddAction :available="available" :disabled="!editable" @add="(t) => emit('add', t)" />
    </div>
  </Panel>
</template>
