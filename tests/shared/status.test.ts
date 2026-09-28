import { describe, expect, it } from 'vitest'
import {
  InvalidTransitionError,
  TICKET_STATUSES,
  TRANSITIONS,
  canTransition,
  transition,
} from '../../shared/status'

describe('ticket status machine', () => {
  it('walks the happy path', () => {
    expect(transition('new', 'researching')).toBe('researching')
    expect(transition('researching', 'needs_decision')).toBe('needs_decision')
    expect(transition('needs_decision', 'executing')).toBe('executing')
    expect(transition('executing', 'closed')).toBe('closed')
  })

  it('supports snooze in both directions', () => {
    expect(canTransition('needs_decision', 'snoozed')).toBe(true)
    expect(canTransition('snoozed', 'needs_decision')).toBe(true)
  })

  it('supports the two-stage refund flow', () => {
    expect(transition('executing', 'waiting_on_customer')).toBe('waiting_on_customer')
    expect(transition('waiting_on_customer', 'researching')).toBe('researching')
  })

  it('supports reject → manual → closed', () => {
    expect(transition('needs_decision', 'manual')).toBe('manual')
    expect(transition('manual', 'closed')).toBe('closed')
  })

  it('supports the Auto undo window', () => {
    expect(transition('executing', 'auto_pending')).toBe('auto_pending')
    expect(transition('auto_pending', 'closed')).toBe('closed')
    expect(transition('auto_pending', 'needs_decision')).toBe('needs_decision')
  })

  it('reopens closed tickets when the customer writes again', () => {
    expect(transition('closed', 'researching')).toBe('researching')
  })

  it('throws on invalid transitions', () => {
    expect(() => transition('new', 'closed')).toThrow(InvalidTransitionError)
    expect(() => transition('closed', 'executing')).toThrow(/Invalid ticket transition/)
    expect(() => transition('researching', 'executing')).toThrow(InvalidTransitionError)
    expect(() => transition('waiting_on_customer', 'executing')).toThrow(InvalidTransitionError)
  })

  it('lets a waiting ticket be marked done when the customer never writes back', () => {
    expect(transition('waiting_on_customer', 'closed')).toBe('closed')
  })

  it('every status has a transition table entry and every target is a known status', () => {
    for (const s of TICKET_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined()
      for (const t of TRANSITIONS[s]) expect(TICKET_STATUSES).toContain(t)
    }
  })
})
