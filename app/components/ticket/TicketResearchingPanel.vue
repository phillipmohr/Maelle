<script setup lang="ts">
/** While the agent works: the live research checklist in the proposal's place (turns ready via Realtime). */
import type { AgentRunRow } from '#shared/api'
import { researchChecklist, researchingLine } from '~/composables/useInboxRows'

const props = defineProps<{ run: AgentRunRow | null }>()
const line = computed(() => researchingLine(props.run?.progress ?? null))
const checklist = computed(() => researchChecklist(props.run?.progress ?? null))
</script>

<template>
  <Panel :padding="24" as="section" aria-label="Researching" aria-live="polite">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <Eyebrow as="h2">Researching</Eyebrow>
        <Mono class="text-[11px]">{{ run?.status === 'failed' ? 'failed' : 'live' }}</Mono>
      </div>
      <p class="flex items-center gap-3 font-serif text-heading leading-[1.2] text-fg-muted">
        <RiskDot kind="research" class="animate-pulse-soft" />{{
          run?.status === 'failed' ? 'Research failed · re-run it or change the case' : line
        }}
      </p>
      <Mono v-if="checklist" class="text-[11px]">{{ checklist }}</Mono>
      <p v-if="run?.error" class="font-mono text-[11.5px] text-brick">{{ run.error }}</p>
    </div>
  </Panel>
</template>
