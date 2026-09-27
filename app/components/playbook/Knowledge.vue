<script setup lang="ts">
/** Examples and Knowledge Base with Active / Draft counts (live from Notion when the read token is set). */
import type { PlaybookResponse } from '#shared/api'

defineProps<{ data: PlaybookResponse }>()
</script>

<template>
  <Panel>
    <PanelHeader
      title="Knowledge"
      eyebrow
      :meta="data.liveCounts ? 'live from Notion' : 'snapshot counts'"
    />
    <div class="divide-hairline">
      <PlaybookLinkRow :href="data.examples.url">
        <span class="flex flex-col gap-px">
          <span class="font-semibold">Examples</span>
          <span class="text-caption text-fg-muted"
            >New examples arrive as Draft and count only once Active</span
          >
        </span>
        <template #meta>
          <Mono v-if="data.examplesStatus"
            >{{ data.examplesStatus.active }} active · {{ data.examplesStatus.draft }} draft</Mono
          >
          <Mono v-else>{{ data.examples.count }}</Mono>
        </template>
      </PlaybookLinkRow>
      <PlaybookLinkRow :href="data.knowledgeBase.url">
        <span class="flex flex-col gap-px">
          <span class="font-semibold">Knowledge Base</span>
          <span class="text-caption text-fg-muted"
            >Drafts come from "Create KB draft" after a reply</span
          >
        </span>
        <template #meta>
          <Mono>{{ data.knowledgeBase.active }} active · {{ data.knowledgeBase.draft }} draft</Mono>
        </template>
      </PlaybookLinkRow>
    </div>
  </Panel>
</template>
