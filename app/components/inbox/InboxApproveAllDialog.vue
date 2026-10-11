<script setup lang="ts">
/**
 * Confirm before "Approve & send all" (IRDR-481): how many replies go out per case type and which
 * tickets are skipped and why. The server decides the set; nothing is sent before Send.
 */
import type { ApproveAllPreviewResponse } from '#shared/api'
import { approveAllBreakdown, approveAllSkippedRows } from '~/composables/useInboxRows'
import { plural } from '~/utils/format'

const props = defineProps<{
  preview: ApproveAllPreviewResponse | null
  loading: boolean
  error: string | null
  busy: boolean
}>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { default: false })

const count = computed(() => props.preview?.eligible.length ?? 0)
const breakdown = computed(() => approveAllBreakdown(props.preview?.eligible ?? []))
const skipped = computed(() => approveAllSkippedRows(props.preview?.skipped ?? []))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :width="560">
      <DialogHeader>
        <Eyebrow tone="accent">Approve & send all</Eyebrow>
        <DialogTitle v-if="loading">Checking the unsent replies…</DialogTitle>
        <DialogTitle v-else-if="error">Could not check the unsent replies</DialogTitle>
        <DialogTitle v-else-if="count === 0">No reply can be sent in bulk</DialogTitle>
        <DialogTitle v-else>Send {{ plural(count, 'reply', 'replies') }}?</DialogTitle>
        <DialogDescription v-if="error">{{ error }}</DialogDescription>
        <DialogDescription v-else-if="!loading"
          >Each reply is approved as proposed and sent now, with its actions, the same as pressing
          Approve on the ticket. Sent replies can't be unsent. Risky, locked, irreversible and
          handed-off tickets stay in the inbox for you.</DialogDescription
        >
      </DialogHeader>
      <div v-if="!loading && !error" class="mt-5 flex flex-col gap-5">
        <KeyValueList v-if="breakdown.length > 0" :items="breakdown" />
        <div v-if="skipped.length > 0" class="flex flex-col gap-2">
          <Eyebrow>{{ skipped.length }} skipped</Eyebrow>
          <KeyValueList :items="skipped" />
        </div>
      </div>
      <DialogFooter>
        <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
        <Button
          :loading="busy"
          :disabled="loading || !!error || count === 0"
          @click="emit('confirm')"
          >Send {{ plural(count, 'reply', 'replies') }}</Button
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
