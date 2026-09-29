/**
 * Section navigation for a scroll container. Sections are discovered, not listed: every direct
 * child `section[aria-label]` of the container becomes an entry (label from `data-nav-label`,
 * falling back to `aria-label`), so a new section shows up in the nav without touching it.
 * A MutationObserver keeps the list in step with sections that mount and unmount (the ticket's
 * view changes which ones render); the active entry follows the scroll position.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'

export interface NavSection {
  id: string
  label: string
  el: HTMLElement
}

export const SECTION_SELECTOR = ':scope > section[aria-label]'

/** Human label for a section element: the short `data-nav-label`, else its `aria-label`. */
export function sectionLabel(el: Pick<HTMLElement, 'getAttribute'>): string {
  return (el.getAttribute('data-nav-label') ?? el.getAttribute('aria-label') ?? '').trim()
}

/**
 * Index of the section being read: the last one whose top has passed the threshold line
 * (`tops` are offsets relative to the visible top of the container). At the very bottom the last
 * section wins, since a short last section can never reach the line. -1 when there is none.
 */
export function activeSectionIndex(tops: number[], threshold: number, atBottom: boolean): number {
  if (!tops.length) return -1
  if (atBottom) return tops.length - 1
  let idx = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= threshold) idx = i
    else break
  }
  return idx
}

export function useSectionNav(
  container: Ref<HTMLElement | null>,
  options: { offset: () => number },
) {
  const sections = shallowRef<NavSection[]>([])
  const activeId = ref<string | null>(null)
  let seq = 0
  let frame = 0
  let collectFrame = 0
  let observer: MutationObserver | null = null
  // While a click-scroll is animating, keep the clicked entry active instead of flickering
  // through the sections it passes.
  let lockedUntil = 0

  function collect() {
    const root = container.value
    if (!root) {
      sections.value = []
      return
    }
    const next = Array.from(root.querySelectorAll<HTMLElement>(SECTION_SELECTOR))
      .map((el) => {
        const label = sectionLabel(el)
        if (!el.dataset.navId) el.dataset.navId = `section-${++seq}`
        return { id: el.dataset.navId, label, el }
      })
      .filter((s) => s.label)
    const prev = sections.value
    const same =
      prev.length === next.length &&
      prev.every((s, i) => s.el === next[i]!.el && s.label === next[i]!.label)
    if (!same) sections.value = next
    update()
  }

  function update() {
    const root = container.value
    if (!root || performance.now() < lockedUntil) return
    const rootTop = root.getBoundingClientRect().top
    const tops = sections.value.map((s) => s.el.getBoundingClientRect().top - rootTop)
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 2
    const idx = activeSectionIndex(tops, options.offset() + 8, atBottom && root.scrollTop > 0)
    activeId.value = sections.value[idx]?.id ?? null
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }

  function scrollTo(id: string) {
    const root = container.value
    const target = sections.value.find((s) => s.id === id)
    if (!root || !target) return
    const top =
      target.el.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop -
      options.offset()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    activeId.value = id
    lockedUntil = performance.now() + 1000 // cleared early by scrollend
    root.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
  }

  function attach(root: HTMLElement) {
    observer = new MutationObserver(() => {
      if (collectFrame) return
      collectFrame = requestAnimationFrame(() => {
        collectFrame = 0
        collect()
      })
    })
    // Direct children mount and unmount with the view; labels can change in place.
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-nav-label'],
    })
    root.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('scrollend', onScrollEnd, { passive: true })
    collect()
  }
  function detach(root: HTMLElement | null) {
    observer?.disconnect()
    observer = null
    root?.removeEventListener('scroll', onScroll)
    root?.removeEventListener('scrollend', onScrollEnd)
    if (frame) cancelAnimationFrame(frame)
    if (collectFrame) cancelAnimationFrame(collectFrame)
    frame = collectFrame = 0
  }
  // The clicked entry stays active once the scroll settles (a short last section can leave
  // the one below it on screen too); the next scroll by the user takes over again.
  function onScrollEnd() {
    lockedUntil = 0
  }

  onMounted(() => {
    watch(
      container,
      (root, old) => {
        detach(old ?? null)
        if (root) attach(root)
        else sections.value = []
      },
      { immediate: true, flush: 'post' },
    )
  })
  onBeforeUnmount(() => detach(container.value))

  return { sections, activeId, scrollTo, refresh: collect }
}
