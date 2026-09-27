<script setup lang="ts">
/**
 * The track record table. Case types with fewer than 5 tickets collapse into one row with Show.
 * Switching a case to Auto asks once; back to Always ask is immediate.
 */
import type { AutonomyMode, CaseTrackRecord } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import { caseShortLabel } from '#shared/case-types'
import { isCollapsedCase } from '#shared/autonomy'

const props = defineProps<{
  cases: CaseTrackRecord[]
  undoWindowMinutes: number
  busy?: boolean
}>()
const emit = defineEmits<{ mode: [caseType: CaseType, mode: AutonomyMode] }>()

const showAll = ref(false)
const visible = computed(() => props.cases.filter((c) => !isCollapsedCase(c)))
const collapsed = computed(() => props.cases.filter(isCollapsedCase))
const rows = computed(() => (showAll.value ? props.cases : visible.value))

const pending = ref<CaseTrackRecord | null>(null)

function onMode(record: CaseTrackRecord, mode: AutonomyMode) {
  if (mode === record.mode) return
  if (mode === 'auto') {
    pending.value = record
    return
  }
  emit('mode', record.caseType, mode)
}

function confirmAuto() {
  const record = pending.value
  pending.value = null
  if (record) emit('mode', record.caseType, 'auto')
}
</script>

<template>
  <Panel>
    <div
      class="grid grid-cols-[minmax(0,1.3fr)_330px_minmax(0,1fr)_260px] gap-5 border-b border-line px-5 py-3 type-eyebrow text-fg-muted"
    >
      <span>Case type</span><span>Last 30 tickets</span><span>Recommendation</span><span>Mode</span>
    </div>
    <div class="divide-hairline">
      <AutonomyCaseRow
        v-for="c in rows"
        :key="c.caseType"
        :record="c"
        :busy="busy"
        @mode="(m) => onMode(c, m)"
      />
      <div v-if="rows.length === 0" class="px-5 py-6 text-small text-fg-muted">
        No decisions yet. The track record fills up as you approve, edit and reject proposals.
      </div>
    </div>
    <div
      v-if="collapsed.length > 0"
      class="flex items-center gap-1 border-t border-line px-5 py-3 text-small text-fg-muted"
    >
      <span
        >{{ collapsed.length }} more case type{{ collapsed.length === 1 ? '' : 's' }} with fewer
        than 5 tickets ·</span
      >
      <button
        type="button"
        class="text-fg-muted underline-offset-3 hover:text-fg hover:underline"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Hide' : 'Show' }}
      </button>
    </div>

    <Dialog :open="pending !== null" @update:open="(v) => !v && (pending = null)">
      <DialogContent v-if="pending">
        <DialogHeader>
          <Eyebrow tone="accent">Hand off</Eyebrow>
          <DialogTitle>Put {{ caseShortLabel(pending.caseType) }} on Auto?</DialogTitle>
          <DialogDescription
            >The next matching ticket runs without your approval. Its reply waits
            {{ undoWindowMinutes }} minutes before sending, so you can undo. Tickets with a locked
            action, a policy warning, high risk or a pending customer confirmation still wait for
            you.</DialogDescription
          >
        </DialogHeader>
        <p
          v-if="pending.recommendationKind !== 'ready'"
          class="mt-4 flex items-center gap-2 text-small text-ember"
        >
          <span class="size-[7px] shrink-0 rotate-45 bg-ember" aria-hidden="true" />
          The record does not recommend this yet: {{ pending.recommendation }}
        </p>
        <DialogFooter>
          <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
          <Button @click="confirmAuto">Switch to Auto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Panel>
</template>
