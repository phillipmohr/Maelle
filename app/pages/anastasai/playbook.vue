<script setup lang="ts">
/** Playbook. Owner: IRDR-459. Read-only links into Notion; the route already serves real data. */
import type { PlaybookResponse } from '#shared/api'
import { actionLabel } from '#shared/actions'

useHead({ title: 'Playbook' })
const { data } = await useFetch<PlaybookResponse>('/api/playbook', { key: 'playbook' })
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex max-w-[640px] flex-col gap-[10px]">
      <h1 class="type-display">Playbook</h1>
      <p class="text-body text-fg-muted [text-wrap:pretty]">
        How AnastasAI writes and decides. Everything lives in Notion and opens there; nothing is
        edited here.
      </p>
    </div>
    <div v-if="data" class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6">
      <div class="flex flex-col gap-6">
        <Panel>
          <PanelHeader title="Protocol" eyebrow />
          <div class="divide-hairline">
            <a
              v-for="p in data.protocol"
              :key="p.title"
              :href="p.url"
              target="_blank"
              rel="noreferrer"
              class="flex items-center justify-between px-[18px] py-3 text-small text-fg no-underline hover:bg-elevated/50 hover:no-underline"
              >{{ p.title }}<span class="text-caption text-fg-muted">Notion ↗</span></a
            >
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Knowledge" eyebrow />
          <div class="divide-hairline">
            <a
              :href="data.examples.url"
              target="_blank"
              rel="noreferrer"
              class="flex items-center justify-between px-[18px] py-3 text-small text-fg no-underline hover:bg-elevated/50 hover:no-underline"
              >Examples<Mono>{{ data.examples.count }}</Mono></a
            >
            <a
              :href="data.knowledgeBase.url"
              target="_blank"
              rel="noreferrer"
              class="flex items-center justify-between px-[18px] py-3 text-small text-fg no-underline hover:bg-elevated/50 hover:no-underline"
              >Knowledge Base<Mono
                >{{ data.knowledgeBase.active }} active · {{ data.knowledgeBase.draft }} draft</Mono
              ></a
            >
          </div>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Templates" :meta="`${data.templates.length} cases`" eyebrow />
        <div class="divide-hairline">
          <a
            v-for="t in data.templates"
            :key="t.caseType"
            :href="t.url"
            target="_blank"
            rel="noreferrer"
            class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-4 px-[18px] py-3 text-fg no-underline hover:bg-elevated/50 hover:no-underline"
          >
            <span class="text-small font-semibold">{{ t.label }}</span>
            <span class="text-caption text-fg-muted">{{
              t.actions.map(actionLabel).join(' · ') || 'Reply only'
            }}</span>
            <StatusPill v-if="t.requiresConfirmation" status="info" :dot="false"
              >Confirm first</StatusPill
            >
            <span v-else class="text-caption text-fg-muted">Notion ↗</span>
          </a>
        </div>
      </Panel>
    </div>
  </div>
</template>
