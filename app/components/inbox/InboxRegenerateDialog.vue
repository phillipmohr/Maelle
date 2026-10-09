<script setup lang="ts">
/** Confirm before every unsent draft is drafted again: one agent run per ticket. */
defineProps<{ count: number; busy: boolean }>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :width="520">
      <DialogHeader>
        <Eyebrow tone="accent">Regenerate drafts</Eyebrow>
        <DialogTitle
          >Draft
          {{ count === 1 ? 'the unsent reply' : `all ${count} unsent replies` }} again?</DialogTitle
        >
        <DialogDescription
          >AnastasAI researches each ticket again and drafts the reply with the current templates,
          protocol and settings. Every draft is a new agent run; nothing is sent. Snoozed tickets
          stay snoozed.</DialogDescription
        >
      </DialogHeader>
      <DialogFooter>
        <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
        <Button :loading="busy" :disabled="count === 0" @click="emit('confirm')"
          >Regenerate {{ count }} {{ count === 1 ? 'draft' : 'drafts' }}</Button
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
