<script setup lang="ts">
/** The most expensive tickets of the window, linked to their breakdown. */
import type { UsageTicketStat } from '#shared/api'
import { caseShortLabel } from '#shared/case-types'
import { totalInputTokens } from '#shared/usage'
import { formatCost, formatTokens } from '~/utils/format'

defineProps<{ tickets: UsageTicketStat[] }>()
</script>

<template>
  <Panel>
    <PanelHeader title="Most expensive tickets" eyebrow :meta="`top ${tickets.length}`" />
    <Table v-if="tickets.length">
      <TableHeader>
        <TableRow>
          <TableHead>Ticket</TableHead>
          <TableHead>Case</TableHead>
          <TableHead class="text-right">Runs</TableHead>
          <TableHead class="text-right">Calls</TableHead>
          <TableHead class="text-right">Tokens</TableHead>
          <TableHead class="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="t in tickets" :key="t.ticketId" interactive>
          <TableCell>
            <NuxtLink
              :to="`/anastasai/t/${t.displayNumber ?? t.ticketId}`"
              class="flex items-center gap-2 text-fg no-underline hover:no-underline"
            >
              <Mono class="text-[11.5px] text-fg-muted">#{{ t.displayNumber ?? '?' }}</Mono>
              <span class="font-semibold">{{ t.customerName ?? 'Unknown' }}</span>
            </NuxtLink>
          </TableCell>
          <TableCell class="text-fg-muted">{{
            t.caseType ? caseShortLabel(t.caseType) : '–'
          }}</TableCell>
          <TableCell mono class="text-right">{{ t.runs }}</TableCell>
          <TableCell mono class="text-right">{{ t.calls }}</TableCell>
          <TableCell mono class="text-right">{{
            formatTokens(totalInputTokens(t) + t.outputTokens, { compact: true })
          }}</TableCell>
          <TableCell mono class="text-right text-fg">{{ formatCost(t.costUsd) }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <div v-else class="px-[18px] py-5 text-small text-fg-muted">
      No tickets with calls in this window.
    </div>
  </Panel>
</template>
