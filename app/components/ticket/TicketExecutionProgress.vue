<script setup lang="ts">
/** Executing: live per-action progress from the approve response and the audit log (Realtime). */
import type { ActionExecutionRow } from '#shared/api'
import { ACTIONS } from '#shared/actions'
import type { ExecutionSummary } from '#shared/services'
import { actionState, pastTense, type EditableAction } from '~/composables/useTicketModel'

const props = defineProps<{
  actions: EditableAction[]
  liveExecutions: ExecutionSummary[]
  executions: ActionExecutionRow[]
  proposalId: string | null
}>()

const rows = computed(() =>
  props.actions
    .filter((a) => a.enabled)
    .map((a) => {
      const live = props.liveExecutions.find((e) => e.type === a.type) ?? null
      const state = actionState(a, props.executions, props.proposalId, live)
      const status = live?.status ?? state.execution?.status ?? 'queued'
      return { a, state, status, done: status === 'succeeded' }
    }),
)
const doneCount = computed(() => rows.value.filter((r) => r.done).length)
</script>

<template>
  <Panel as="section" aria-label="Executing" aria-live="polite">
    <PanelHeader title="Executing" :meta="`${doneCount} of ${rows.length} done`" eyebrow />
    <div class="divide-hairline">
      <div
        v-for="r in rows"
        :key="r.a.key"
        class="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-3 px-[18px] py-[13px]"
      >
        <Checkbox
          class="mt-[2px]"
          :model-value="r.done"
          :tone="r.state.tone === 'default' ? 'queued' : r.state.tone"
          readonly
        />
        <div class="flex min-w-0 flex-col gap-1">
          <span
            class="text-body font-semibold"
            :class="ACTIONS[r.a.type].irreversible ? 'text-ember' : 'text-fg'"
            >{{
              r.done
                ? pastTense({
                    type: r.a.type,
                    params: r.a.params,
                    result: r.state.execution?.result,
                  })
                : ACTIONS[r.a.type].label
            }}</span
          >
          <span v-if="r.state.error" class="font-mono text-[11.5px] text-brick">{{
            r.state.error
          }}</span>
        </div>
        <StatusPill
          :status="
            r.status === 'succeeded'
              ? 'success'
              : r.status === 'failed'
                ? 'error'
                : r.status === 'held'
                  ? 'warning'
                  : 'info'
          "
          :class="r.status === 'running' || r.status === 'queued' ? 'animate-pulse-soft' : ''"
        >
          {{
            r.status === 'succeeded'
              ? 'Done'
              : r.status === 'failed'
                ? 'Failed'
                : r.status === 'held'
                  ? 'Held back'
                  : r.status === 'running'
                    ? 'Running'
                    : 'Queued'
          }}
        </StatusPill>
      </div>
    </div>
  </Panel>
</template>
