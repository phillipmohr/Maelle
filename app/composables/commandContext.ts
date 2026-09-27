import type { InjectionKey, Ref } from 'vue'

/** Provided by `Command`, consumed by CommandInput, CommandItem and CommandEmpty. */
export interface CommandContext {
  query: Ref<string>
  registerItem: (id: string, text: string) => void
  unregisterItem: (id: string) => void
  matches: (text: string) => boolean
  visibleCount: Ref<number>
}

export const COMMAND_KEY: InjectionKey<CommandContext> = Symbol('maelle.command')
