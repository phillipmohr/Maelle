<script setup lang="ts">
/** Ticket header: name, email, id, K/J, then the case label (click to change), status pills, chips. */
import type { ActionExecutionRow, ProposalRow, TicketRow } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import { headerChips, headerPills, type EditableAction } from '~/composables/useTicketModel'

const props = defineProps<{
  ticket: TicketRow
  proposal: ProposalRow | null
  actions: EditableAction[]
  executions: ActionExecutionRow[]
  now: Date
  caseEditable: boolean
}>()
const emit = defineEmits<{ setCase: [caseType: CaseType] }>()
const casePickerOpen = defineModel<boolean>('casePickerOpen', { default: false })

const pills = computed(() => headerPills(props.ticket, props.proposal, props.executions))
const chips = computed(() =>
  headerChips(props.ticket, props.proposal, props.actions, props.executions, props.now),
)
const unclear = computed(
  () => props.ticket.caseType === 'unclear' || props.proposal?.caseType === 'unclear',
)
</script>

<template>
  <header class="flex flex-col gap-[10px]">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-baseline gap-[10px]">
        <h1 class="whitespace-nowrap text-[18px] font-semibold leading-[1.35]">
          {{ ticket.customerName ?? ticket.customerEmail }}
        </h1>
        <Mono class="truncate">{{ ticket.customerEmail }}</Mono>
      </div>
      <div class="flex shrink-0 items-center gap-[6px]">
        <Mono class="mr-[6px]">#{{ ticket.displayNumber }}</Mono>
        <Kbd keys="K" /><Kbd keys="J" />
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <TicketCasePicker
        v-model:open="casePickerOpen"
        :current="ticket.caseType"
        :candidates="proposal?.candidateCases ?? []"
        :required="unclear"
        :disabled="!caseEditable"
        @pick="(c) => emit('setCase', c)"
      />
      <StatusPill v-for="p in pills" :key="p.label" :status="p.status" :dot="p.dot ?? true">{{
        p.label
      }}</StatusPill>
      <Chip v-for="c in chips" :key="c" variant="meta">{{ c }}</Chip>
    </div>
  </header>
</template>
