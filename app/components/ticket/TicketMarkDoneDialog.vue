<script setup lang="ts">
/** Mark as done manually: a note is required (it goes into the audit trail). */
const emit = defineEmits<{ confirm: [note: string] }>()
const open = defineModel<boolean>('open', { default: false })
const note = ref('')
watch(open, (o) => {
  if (o) note.value = ''
})
function confirm() {
  if (!note.value.trim()) return
  open.value = false
  emit('confirm', note.value.trim())
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :width="520">
      <DialogHeader>
        <Eyebrow tone="accent">Mark as done</Eyebrow>
        <DialogTitle>What did you do outside Maelle?</DialogTitle>
        <DialogDescription>One line for the audit trail. Nothing else runs.</DialogDescription>
      </DialogHeader>
      <div class="mt-5">
        <Textarea
          v-model="note"
          :rows="3"
          autofocus
          placeholder="Stored the email by hand in Supabase"
          @keydown.meta.enter.prevent="confirm"
          @keydown.ctrl.enter.prevent="confirm"
        />
      </div>
      <DialogFooter>
        <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
        <Button kbd="⌘⏎" :disabled="!note.trim()" @click="confirm">Mark as done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
