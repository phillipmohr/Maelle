<script setup lang="ts">
/** Playbook. Owner: IRDR-459. Read-only links into Notion; nothing is edited here. */
import type { PlaybookResponse } from '#shared/api'

useHead({ title: 'Playbook' })
const { data } = await useFetch<PlaybookResponse>('/api/playbook', { key: 'playbook' })
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex max-w-[640px] flex-col gap-[10px]">
      <h1 class="type-display">Playbook</h1>
      <p class="text-body text-fg-muted [text-wrap:pretty]">
        How AnastasAI writes and decides. Everything lives in Notion and opens there; nothing is
        edited in Maelle.
      </p>
    </div>
    <div v-if="data" class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-6">
      <div class="flex flex-col gap-6">
        <PlaybookProtocol :protocol="data.protocol" />
        <PlaybookKnowledge :data="data" />
      </div>
      <PlaybookTemplates :templates="data.templates" />
    </div>
  </div>
</template>
