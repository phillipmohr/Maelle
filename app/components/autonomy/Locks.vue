<script setup lang="ts">
/**
 * Per-action locks for Auto. Refund latest payment, Cancel immediately and Delete account are
 * locked by default; a ticket in an Auto case that contains a locked action falls back to Always ask.
 */
import type { AutonomyResponse, AutonomyUpdateRequest } from '#shared/api'
import { ACTIONS } from '#shared/actions'

defineProps<{ locks: AutonomyResponse['locks']; busy?: boolean }>()
const emit = defineEmits<{ update: [patch: AutonomyUpdateRequest] }>()
</script>

<template>
  <Panel>
    <PanelHeader
      title="Locked for Auto"
      eyebrow
      :meta="`${locks.filter((l) => l.locked).length} of ${locks.length}`"
    />
    <p class="border-b border-line px-[18px] py-3 text-caption leading-[1.45] text-fg-muted">
      A ticket in an Auto case that contains a locked action waits for you instead.
    </p>
    <div class="divide-hairline">
      <label
        v-for="l in locks"
        :key="l.type"
        class="flex cursor-pointer items-center justify-between gap-4 px-[18px] py-[9px] text-small"
      >
        <span
          class="flex items-center gap-2"
          :class="ACTIONS[l.type].irreversible ? 'text-ember' : 'text-fg'"
        >
          <LockShape
            v-if="ACTIONS[l.type].irreversible"
            :color="l.locked ? 'var(--ember-400)' : 'var(--sand-400)'"
          />
          <span class="font-semibold">{{ ACTIONS[l.type].label }}</span>
          <span v-if="ACTIONS[l.type].irreversible" class="text-[11px] font-medium text-fg-muted"
            >irreversible</span
          >
        </span>
        <span class="flex items-center gap-2 text-caption text-fg-muted">
          {{ l.locked ? 'Locked' : 'Allowed on Auto' }}
          <Checkbox
            :model-value="l.locked"
            :disabled="busy"
            :aria-label="`Lock ${ACTIONS[l.type].label} for Auto`"
            @update:model-value="(v) => emit('update', { locks: { [l.type]: v === true } })"
          />
        </span>
      </label>
    </div>
  </Panel>
</template>
