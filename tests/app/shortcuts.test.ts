// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchKeydown,
  eventToken,
  formatKeys,
  isTypingTarget,
  resetShortcutsForTests,
  tokensOf,
  useShortcuts,
} from '../../app/composables/useShortcuts'

function key(k: string, opts: Partial<KeyboardEventInit> & { target?: EventTarget } = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts })
  if (opts.target) Object.defineProperty(e, 'target', { value: opts.target })
  return e
}

describe('shortcut tokens', () => {
  it('normalizes chords and sequences', () => {
    expect(tokensOf('mod+k')).toEqual(['mod+k'])
    expect(tokensOf('⌘K')).toEqual(['mod+k'])
    expect(tokensOf('g i')).toEqual(['g', 'i'])
    expect(tokensOf('Shift+R')).toEqual(['shift+r'])
    expect(tokensOf('Esc')).toEqual(['escape'])
  })

  it('maps events to tokens', () => {
    expect(eventToken(key('k', { metaKey: true }))).toBe('mod+k')
    expect(eventToken(key('k', { ctrlKey: true }))).toBe('mod+k')
    expect(eventToken(key('?', { shiftKey: true }))).toBe('?')
    expect(eventToken(key('Enter', { metaKey: true }))).toBe('mod+enter')
    expect(eventToken(key('Escape'))).toBe('escape')
  })

  it('formats for the overlay', () => {
    expect(formatKeys('mod+k')).toEqual(['⌘K'])
    expect(formatKeys('g i')).toEqual(['G', 'I'])
    expect(formatKeys('enter')).toEqual(['⏎'])
    expect(formatKeys('mod+k', false)).toEqual(['Ctrl+K'])
  })

  it('detects typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
  })
})

describe('dispatch', () => {
  beforeEach(() => resetShortcutsForTests())

  it('fires single keys and respects scope', () => {
    const { register, activeScope } = useShortcuts()
    const approve = vi.fn()
    const next = vi.fn()
    register([
      { id: 'a', keys: 'a', label: 'Approve', scope: 'ticket', handler: approve },
      { id: 'j', keys: 'j', label: 'Next', scope: 'global', handler: next },
    ])
    activeScope.value = 'inbox'
    dispatchKeydown(key('a'))
    dispatchKeydown(key('j'))
    expect(approve).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    activeScope.value = 'ticket'
    dispatchKeydown(key('a'))
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it('handles sequences like G I', () => {
    const { register } = useShortcuts()
    const inbox = vi.fn()
    register({ id: 'gi', keys: 'g i', label: 'Inbox', handler: inbox })
    expect(dispatchKeydown(key('g'))).toBe(true)
    expect(inbox).not.toHaveBeenCalled()
    dispatchKeydown(key('i'))
    expect(inbox).toHaveBeenCalledTimes(1)
  })

  it('is disabled while typing, except mod+enter and escape', () => {
    const { register } = useShortcuts()
    const approve = vi.fn()
    const send = vi.fn()
    const back = vi.fn()
    register([
      { id: 'a', keys: 'a', label: 'Approve', handler: approve },
      { id: 'send', keys: 'mod+enter', label: 'Send', handler: send },
      { id: 'esc', keys: 'escape', label: 'Back', handler: back },
    ])
    const input = document.createElement('textarea')
    dispatchKeydown(key('a', { target: input }))
    dispatchKeydown(key('Enter', { metaKey: true, target: input }))
    dispatchKeydown(key('Escape', { target: input }))
    expect(approve).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('honours when() and unregisters', () => {
    const { register } = useShortcuts()
    let selected = false
    const open = vi.fn()
    const dispose = register({
      id: 'enter',
      keys: 'enter',
      label: 'Open',
      when: () => selected,
      handler: open,
    })
    dispatchKeydown(key('Enter'))
    expect(open).not.toHaveBeenCalled()
    selected = true
    dispatchKeydown(key('Enter'))
    expect(open).toHaveBeenCalledTimes(1)
    dispose()
    dispatchKeydown(key('Enter'))
    expect(open).toHaveBeenCalledTimes(1)
  })
})
