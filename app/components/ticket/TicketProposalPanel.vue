<script setup lang="ts">
/** The proposal: the only lit surface. Proposal line, meta, provenance, policy warnings. */
import type { ProposalRow } from '#shared/api'
import { provenanceLine } from '~/composables/useTicketModel'

const props = defineProps<{ proposal: ProposalRow }>()
const provenance = computed(() => provenanceLine(props.proposal))
</script>

<template>
  <Panel elevation="focus" :padding="24" as="section" aria-label="Proposal">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <Eyebrow tone="accent" as="h2">Proposal</Eyebrow>
        <Mono class="text-[11px]">{{ proposal.metaLine }}</Mono>
      </div>
      <p class="font-serif text-heading leading-[1.2] text-fg [text-wrap:pretty]">
        {{ proposal.summaryLine }}
      </p>
      <Provenance>{{ provenance }}</Provenance>
      <div v-if="proposal.policyWarnings.length" class="flex flex-col gap-[6px] pt-1">
        <div
          v-for="w in proposal.policyWarnings"
          :key="w"
          class="flex items-start gap-2 rounded-md border border-ember/33 bg-ember/8 px-3 py-2 text-caption text-fg"
        >
          <span class="mt-[5px] size-[6px] shrink-0 rounded-pill bg-ember" aria-hidden="true" />{{
            w
          }}
        </div>
      </div>
    </div>
  </Panel>
</template>
