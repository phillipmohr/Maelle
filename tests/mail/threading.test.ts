import { describe, expect, it } from 'vitest'
import { normalizeSubject } from '../../server/mail/threading'

describe('normalizeSubject', () => {
  it('strips reply and forward prefixes, tags, whitespace and case', () => {
    expect(normalizeSubject('Re: Re: AW: [External] Please  cancel')).toBe('please cancel')
    expect(normalizeSubject('Fwd: receipt')).toBe('receipt')
    expect(normalizeSubject('RE : bonjour')).toBe('bonjour')
    expect(normalizeSubject('WG: Antw: Problem')).toBe('problem')
    expect(normalizeSubject('Re[2]: hello')).toBe('hello')
    expect(normalizeSubject('  Cancel   my plan ')).toBe('cancel my plan')
    expect(normalizeSubject(null)).toBe('')
  })

  it('leaves subjects that merely start with a word like "Reply" alone', () => {
    expect(normalizeSubject('Reply needed')).toBe('reply needed')
    expect(normalizeSubject('Regarding my refund')).toBe('regarding my refund')
  })
})
