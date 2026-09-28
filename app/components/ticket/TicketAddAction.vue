<script setup lang="ts">
/** "+ Add action from the predefined list": the registry minus what the proposal already has. */
import { ACTIONS, type ActionType } from '#shared/actions'

defineProps<{ available: ActionType[]; disabled?: boolean }>()
const emit = defineEmits<{ add: [type: ActionType] }>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      :disabled="disabled || available.length === 0"
      class="flex w-full items-center gap-[10px] px-[18px] py-[11px] text-left text-small text-fg-muted outline-none transition-fast hover:text-fg focus-visible:outline-offset-[-2px] disabled:cursor-default disabled:opacity-60"
    >
      <span class="font-semibold text-fg">+ Add action</span><span>from the predefined list</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="w-[360px]">
      <DropdownMenuLabel>The registry · {{ available.length }} left</DropdownMenuLabel>
      <DropdownMenuItem v-for="t in available" :key="t" @select="emit('add', t)">
        <span class="flex flex-col gap-px py-px">
          <span
            class="flex items-center gap-2 font-semibold"
            :class="ACTIONS[t].irreversible ? 'text-ember' : 'text-fg'"
            ><LockShape v-if="ACTIONS[t].irreversible" />{{ ACTIONS[t].label }}</span
          >
          <span class="text-caption text-fg-muted [text-wrap:pretty]">{{
            ACTIONS[t].description
          }}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
