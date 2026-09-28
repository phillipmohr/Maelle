<script setup lang="ts">
/** The 17 template cases with their executable actions and whether the customer confirms first. */
import type { PlaybookResponse } from '#shared/api'
import { ACTIONS, actionLabel } from '#shared/actions'

defineProps<{ templates: PlaybookResponse['templates'] }>()
</script>

<template>
  <Panel>
    <PanelHeader title="Templates" :meta="`${templates.length} cases`" eyebrow />
    <div class="divide-hairline">
      <a
        v-for="t in templates"
        :key="t.caseType"
        :href="t.url"
        target="_blank"
        rel="noreferrer noopener"
        class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px] items-center gap-4 px-[18px] py-3 text-fg no-underline transition-fast [transition-property:background-color] hover:bg-elevated/50 hover:no-underline"
      >
        <span class="text-small font-semibold">{{ t.label }}</span>
        <span class="flex flex-wrap items-center gap-x-[6px] text-caption text-fg-muted">
          <template v-if="t.actions.length === 0">Reply only</template>
          <template v-for="(a, i) in t.actions" :key="a">
            <span
              :class="ACTIONS[a].irreversible ? 'inline-flex items-center gap-1 text-ember' : ''"
              ><LockShape v-if="ACTIONS[a].irreversible" />{{ actionLabel(a) }}</span
            ><span v-if="i < t.actions.length - 1">·</span>
          </template>
        </span>
        <span class="flex justify-end">
          <StatusPill v-if="t.requiresConfirmation" status="info" :dot="false"
            >Confirm first</StatusPill
          >
          <span v-else class="text-caption text-fg-muted">Notion ↗</span>
        </span>
      </a>
    </div>
  </Panel>
</template>
