<script setup lang="ts">
/**
 * One proposed action: CSS checkbox, name (ember with a lock when irreversible), params in mono,
 * "Because: …", the Irreversible / Reversible tag and the state pill from the audit log
 * (Queued · pending confirmation, Done, Linked, Failed with the error, Held back, Required).
 */
import { ACTIONS, isIrreversible } from '#shared/actions'
import { paramsSummary, type ActionState, type EditableAction } from '~/composables/useTicketModel'

const props = defineProps<{
  action: EditableAction
  state: ActionState
  editable: boolean
  attachments?: number
}>()
const emit = defineEmits<{
  'update:enabled': [enabled: boolean]
  'update:params': [params: Record<string, unknown>]
  remove: []
}>()

const paramsOpen = ref(props.action.added)
const label = computed(() => ACTIONS[props.action.type].label)
const irreversible = computed(() => isIrreversible(props.action.type))
const summary = computed(() => paramsSummary(props.action, props.attachments ?? 0))
const checkboxTone = computed(() => (props.state.tone === 'default' ? 'default' : props.state.tone))
const readonlyBox = computed(() => !props.editable || props.state.tone !== 'default')
</script>

<template>
  <div
    class="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-3 px-[18px] py-[13px]"
    :class="[state.tone === 'queued' && 'bg-slate-blue/4', !action.enabled && 'opacity-60']"
  >
    <Checkbox
      class="mt-[2px]"
      :model-value="state.tone === 'default' ? action.enabled : true"
      :tone="checkboxTone"
      :readonly="readonlyBox"
      :aria-label="`${label} enabled`"
      @update:model-value="(v) => !readonlyBox && emit('update:enabled', Boolean(v))"
    />
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex flex-wrap items-baseline gap-[10px]">
        <span class="text-body font-semibold" :class="irreversible ? 'text-ember' : 'text-fg'">{{
          label
        }}</span>
        <Mono>{{ summary }}</Mono>
        <button
          v-if="editable && state.tone === 'default'"
          type="button"
          class="text-caption font-semibold text-fg-muted hover:text-fg"
          :aria-expanded="paramsOpen ? 'true' : 'false'"
          @click="paramsOpen = !paramsOpen"
        >
          {{ paramsOpen ? 'Done' : action.added ? 'Fill in' : 'Edit params' }}
        </button>
        <button
          v-if="action.added && editable"
          type="button"
          class="text-caption font-semibold text-fg-muted hover:text-brick"
          @click="emit('remove')"
        >
          Remove
        </button>
      </div>
      <span class="text-caption leading-[1.45] text-fg-muted">{{ action.reason }}</span>
      <div
        v-if="state.error"
        class="mt-1 rounded-md border border-brick/33 bg-brick/8 px-3 py-2 font-mono text-[11.5px] text-brick"
      >
        {{ state.error }}
      </div>
      <TicketParamEditor
        v-if="paramsOpen && editable"
        :type="action.type"
        :params="action.params"
        @update:params="(p) => emit('update:params', p)"
      />
    </div>
    <div class="flex items-start gap-2">
      <span
        v-if="irreversible"
        class="inline-flex items-center gap-[6px] rounded-sm border border-ember/33 bg-ember/8 px-2 py-[2px] text-[11px] font-semibold text-ember"
        ><LockShape />Irreversible</span
      >
      <span
        v-else-if="!state.pill"
        class="rounded-sm border border-line px-2 py-[2px] text-[11px] font-medium text-fg-muted"
        >Reversible</span
      >
      <StatusPill v-if="state.pill" :status="state.pill.status">{{ state.pill.label }}</StatusPill>
    </div>
  </div>
</template>
