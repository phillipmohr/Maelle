<script setup lang="ts">
/** Research tools of the agent loop: how often, how much context they add, how long they take. */
import type { UsageToolStat } from '#shared/api'
import { duration, formatTokens } from '~/utils/format'

defineProps<{ tools: UsageToolStat[] }>()
</script>

<template>
  <Panel>
    <PanelHeader title="Tools" eyebrow meta="context tokens per call" />
    <Table v-if="tools.length">
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead class="text-right">Calls</TableHead>
          <TableHead class="text-right">Avg ctx</TableHead>
          <TableHead class="text-right">Total ctx</TableHead>
          <TableHead class="text-right">Avg time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="t in tools" :key="t.tool">
          <TableCell
            ><Mono class="text-[11.5px] text-fg">{{ t.tool }}</Mono></TableCell
          >
          <TableCell mono class="text-right"
            >{{ t.calls
            }}<span v-if="t.failed" class="text-brick"> · {{ t.failed }} failed</span></TableCell
          >
          <TableCell mono class="text-right">{{ formatTokens(t.avgContextTokens) }}</TableCell>
          <TableCell mono class="text-right">{{
            formatTokens(t.contextTokens, { compact: true })
          }}</TableCell>
          <TableCell mono class="text-right">{{ duration(t.avgDurationMs) }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <div v-else class="px-[18px] py-5 text-small text-fg-muted">No tool calls in this window.</div>
    <p class="border-t border-line px-[18px] py-2 text-[11px] text-fg-muted">
      ctx = tokens the tool's result added to the context; every later turn reads them again.
    </p>
  </Panel>
</template>
