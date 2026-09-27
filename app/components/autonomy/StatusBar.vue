<script setup lang="ts">
/**
 * "Automation running · 1 case type on Auto · 16 on Always ask" with Pause all. Pausing is one
 * click (the brake); resuming asks once.
 */
const props = defineProps<{
  globalPause: boolean
  onAutoCount: number
  alwaysAskCount: number
  busy?: boolean
}>()
const emit = defineEmits<{ pause: []; resume: [] }>()
const confirmResume = ref(false)

function resume() {
  confirmResume.value = false
  emit('resume')
}

const counts = computed(
  () =>
    `${props.onAutoCount} case type${props.onAutoCount === 1 ? '' : 's'} on Auto · ${props.alwaysAskCount} on Always ask`,
)
</script>

<template>
  <div
    class="flex items-center gap-4 rounded-lg border bg-base py-3 pl-[18px] pr-[14px]"
    :class="globalPause ? 'border-brick/33' : 'border-line'"
  >
    <div class="flex flex-col gap-[2px]">
      <span class="flex items-center gap-2 text-small font-semibold">
        <span
          class="size-[6px] rounded-pill"
          :class="globalPause ? 'bg-brick' : 'bg-sage'"
          aria-hidden="true"
        />
        {{ globalPause ? 'Automation paused' : 'Automation running' }}
      </span>
      <span class="text-caption text-fg-muted">{{
        globalPause ? `Nothing runs on Auto · ${counts}` : counts
      }}</span>
    </div>
    <Button
      v-if="!globalPause"
      variant="secondary"
      size="sm"
      :disabled="busy"
      @click="emit('pause')"
      >Pause all</Button
    >
    <Button v-else size="sm" :disabled="busy" @click="confirmResume = true">Resume</Button>

    <Dialog v-model:open="confirmResume">
      <DialogContent>
        <DialogHeader>
          <Eyebrow tone="accent">Automation</Eyebrow>
          <DialogTitle
            >Resume Auto for {{ onAutoCount }} case type{{
              onAutoCount === 1 ? '' : 's'
            }}?</DialogTitle
          >
          <DialogDescription
            >Matching tickets run without approval again. Everything else keeps waiting for
            you.</DialogDescription
          >
        </DialogHeader>
        <DialogFooter>
          <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
          <Button @click="resume">Resume</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
