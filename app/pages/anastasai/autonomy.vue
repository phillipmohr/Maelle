<script setup lang="ts">
/** Autonomy page. Owner: IRDR-459 (screen 1h). */
import type { AutonomyMode, AutonomyResponse, AutonomyUpdateRequest } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import { useToast } from '~/composables/useToast'

useHead({ title: 'Autonomy' })
const { data } = await useFetch<AutonomyResponse>('/api/autonomy', { key: 'autonomy' })
const toast = useToast()
const busy = ref(false)

function errorMessage(e: unknown): string {
  const err = e as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.statusMessage ??
    err?.data?.message ??
    err?.statusMessage ??
    err?.message ??
    'Unknown error'
  )
}

async function update(patch: AutonomyUpdateRequest, fallbackLabel: string) {
  busy.value = true
  try {
    const res = await $fetch<AutonomyResponse>('/api/autonomy', { method: 'PUT', body: patch })
    data.value = res
    const summary = res.changes?.map((c) => c.summary).join(' · ')
    toast.info(summary ? 'Saved' : 'Nothing changed', summary || fallbackLabel)
  } catch (e) {
    toast.error('Not saved', errorMessage(e))
  } finally {
    busy.value = false
  }
}

const setMode = (caseType: CaseType, mode: AutonomyMode) =>
  update({ modes: { [caseType]: mode } }, `${caseType} → ${mode}`)
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-7 overflow-auto px-12 pb-12 pt-9">
    <div class="flex items-end justify-between gap-8">
      <div class="flex max-w-[640px] flex-col gap-[10px]">
        <h1 class="type-display">Autonomy</h1>
        <p class="text-body text-fg-muted [text-wrap:pretty]">
          Hand off one case type at a time, based on its track record. The goal is full autonomy:
          move each case to Auto once its record earns it.
        </p>
      </div>
      <AutonomyStatusBar
        v-if="data"
        :global-pause="data.settings.globalPause"
        :on-auto-count="data.onAutoCount"
        :always-ask-count="data.alwaysAskCount"
        :busy="busy"
        @pause="update({ settings: { globalPause: true } }, 'Pause all: on')"
        @resume="update({ settings: { globalPause: false } }, 'Pause all: off')"
      />
    </div>

    <template v-if="data">
      <AutonomyTable
        :cases="data.cases"
        :undo-window-minutes="data.settings.undoWindowMinutes"
        :busy="busy"
        @mode="setMode"
      />

      <div class="grid grid-cols-[560px_minmax(0,1fr)] items-start gap-6">
        <AutonomySafetyNet
          :settings="data.settings"
          :busy="busy"
          @update="(p) => update(p, 'Settings')"
        />
        <div class="flex flex-col gap-6">
          <AutonomyLocks :locks="data.locks" :busy="busy" @update="(p) => update(p, 'Locks')" />
          <AutonomyLimits
            :settings="data.settings"
            :busy="busy"
            @update="(p) => update(p, 'Limits')"
          />
        </div>
      </div>

      <p class="text-caption text-fg-muted">
        Every change is recorded in the audit trail ·
        <NuxtLink to="/anastasai/activity" class="text-fg-muted underline-offset-3 hover:text-fg"
          >View activity log</NuxtLink
        >
      </p>
    </template>
  </div>
</template>
