/**
 * One `now` for relative times ("3h", "Tmrw"). It is created on the server, carried in the payload
 * and reused by the client, so the server-rendered markup and the hydration render agree. On the
 * client it then ticks every 30 seconds so ages stay honest while the page is open.
 */
export function useTicketClock() {
  const now = useState<number>('tickets:now', () => Date.now())
  if (import.meta.client) {
    const started = useState<boolean>('tickets:now.ticking', () => false)
    if (!started.value) {
      started.value = true
      onNuxtReady(() => {
        now.value = Date.now()
        setInterval(() => {
          now.value = Date.now()
        }, 30_000)
      })
    }
  }
  return { now, nowDate: computed(() => new Date(now.value)) }
}
