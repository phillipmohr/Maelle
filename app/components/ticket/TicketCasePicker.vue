<script setup lang="ts">
/**
 * Change the case. Normally a dropdown on the case label; for an unclear classification a required
 * dialog with the agent's candidates first (1, 2, 3) and every template case below.
 */
import { CASE_TYPES, TEMPLATE_CASE_TYPES, caseLabel, type CaseType } from '#shared/case-types'
import type { CandidateCase } from '#shared/proposal'
import { useShortcuts } from '~/composables/useShortcuts'

const props = withDefaults(
  defineProps<{
    current: CaseType | null
    candidates?: CandidateCase[]
    required?: boolean
    disabled?: boolean
  }>(),
  { candidates: () => [], required: false, disabled: false },
)
const emit = defineEmits<{ pick: [caseType: CaseType] }>()
const open = defineModel<boolean>('open', { default: false })

const label = computed(() =>
  props.current ? caseLabel(props.current) : props.required ? 'Pick the case' : 'Classifying…',
)
const candidateKeys = computed(() => props.candidates.map((c) => c.case))
const rest = computed(() => TEMPLATE_CASE_TYPES.filter((k) => !candidateKeys.value.includes(k)))

function pick(c: CaseType) {
  open.value = false
  emit('pick', c)
}

const { register } = useShortcuts()
register(
  [0, 1, 2].map((i) => ({
    id: `ticket.case.candidate${i}`,
    keys: String(i + 1),
    label: `Pick candidate ${i + 1}`,
    group: 'Decision',
    scope: 'ticket',
    hidden: true,
    when: () => props.required && open.value && props.candidates.length > i,
    handler: () => {
      const c = props.candidates[i]
      if (c) pick(c.case)
    },
  })),
)
</script>

<template>
  <Dialog v-if="required" v-model:open="open">
    <DialogTrigger as-child>
      <button
        type="button"
        class="rounded-sm border border-ember/33 bg-ember/8 px-2 py-[3px] text-caption font-medium text-ember hover:border-ember"
      >
        {{ label }}
      </button>
    </DialogTrigger>
    <DialogContent :width="560" hide-close>
      <DialogHeader>
        <Eyebrow tone="accent">Case</Eyebrow>
        <DialogTitle>Which case is this?</DialogTitle>
        <DialogDescription
          >AnastasAI was not sure. Pick one and the research runs again with that
          template.</DialogDescription
        >
      </DialogHeader>
      <div v-if="candidates.length" class="mt-5 flex flex-col gap-2">
        <Eyebrow>Candidates</Eyebrow>
        <button
          v-for="(c, i) in candidates"
          :key="c.case"
          type="button"
          class="flex items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left hover:border-line-strong"
          @click="pick(c.case)"
        >
          <span class="flex flex-col gap-px">
            <span class="text-body font-semibold">{{ caseLabel(c.case) }}</span>
            <span class="text-caption text-fg-muted">{{ CASE_TYPES[c.case].trigger }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-3">
            <Mono>{{ Math.round(c.confidence * 100) }}%</Mono><Kbd :keys="String(i + 1)" />
          </span>
        </button>
      </div>
      <div class="mt-5 flex flex-col gap-2">
        <Eyebrow>Every case</Eyebrow>
        <div class="flex flex-wrap gap-[6px]">
          <Chip v-for="k in rest" :key="k" variant="filter" interactive @click="pick(k)">{{
            CASE_TYPES[k].shortLabel
          }}</Chip>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <DropdownMenu v-else v-model:open="open">
    <DropdownMenuTrigger
      :disabled="disabled"
      class="rounded-sm border border-line px-2 py-[3px] text-caption font-medium text-fg outline-none transition-fast hover:border-line-strong disabled:cursor-default disabled:hover:border-line"
      aria-label="Change the case"
    >
      {{ label }}
    </DropdownMenuTrigger>
    <DropdownMenuContent class="max-h-[420px] w-[320px] overflow-auto">
      <DropdownMenuLabel>Change the case</DropdownMenuLabel>
      <DropdownMenuItem v-for="k in TEMPLATE_CASE_TYPES" :key="k" @select="pick(k)">
        <span :class="k === current ? 'text-fg-accent' : ''">{{ caseLabel(k) }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
