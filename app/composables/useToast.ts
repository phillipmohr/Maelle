import { toast } from 'vue-sonner'

/**
 * Toasts in the Maelle voice. `done` renders the post-approval toast:
 * title "#4823 Sofia Ruiz · done", one line per action, footer text.
 */
export function useToast() {
  return {
    toast,
    done(title: string, lines: string[], footer = 'Moved to the next ticket · View audit trail') {
      return toast.success(title, {
        description: [...lines.map((l) => `✓ ${l}`), '', footer].join('\n'),
      })
    },
    error(title: string, description?: string) {
      return toast.error(title, { description })
    },
    info(title: string, description?: string) {
      return toast(title, { description })
    },
    warning(title: string, description?: string) {
      return toast.warning(title, { description })
    },
  }
}
