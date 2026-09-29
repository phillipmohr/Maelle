import { describe, expect, it } from 'vitest'
import { activeSectionIndex, sectionLabel } from '../../app/composables/useSectionNav'

const el = (attrs: Record<string, string>) => ({ getAttribute: (k: string) => attrs[k] ?? null })

describe('sectionLabel', () => {
  it('prefers the short nav label over the aria-label', () => {
    expect(
      sectionLabel(el({ 'aria-label': 'Customer message', 'data-nav-label': 'Message' })),
    ).toBe('Message')
  })
  it('falls back to the aria-label, so a new section needs nothing extra', () => {
    expect(sectionLabel(el({ 'aria-label': 'Research' }))).toBe('Research')
    expect(sectionLabel(el({}))).toBe('')
  })
})

describe('activeSectionIndex', () => {
  it('is -1 without sections', () => {
    expect(activeSectionIndex([], 50, false)).toBe(-1)
  })
  it('picks the first section before anything has scrolled past the line', () => {
    expect(activeSectionIndex([120, 400, 900], 50, false)).toBe(0)
  })
  it('picks the last section whose top passed the line', () => {
    expect(activeSectionIndex([-300, 20, 600], 50, false)).toBe(1)
    expect(activeSectionIndex([-900, -400, 50], 50, false)).toBe(2)
  })
  it('picks the last section at the bottom, even when it never reaches the line', () => {
    expect(activeSectionIndex([-900, -400, 300], 50, true)).toBe(2)
  })
})
