import { describe, expect, it } from 'vitest'
import { stripSignOff } from '../../server/agent/finalize'

describe('stripSignOff', () => {
  it('removes a closing line and the short signature lines after it', () => {
    const body =
      'Hi Tom, thanks for reaching out!\n\nI have scheduled the cancellation for October 5.\n\nBest regards,\nAnastasia\nInstaRadar Support'
    expect(stripSignOff(body)).toBe(
      'Hi Tom, thanks for reaching out!\n\nI have scheduled the cancellation for October 5.',
    )
  })

  it('handles other closings, trailing whitespace and a bare name', () => {
    expect(stripSignOff('Done.\n\nKind regards\nAnastasia\n\n')).toBe('Done.')
    expect(
      stripSignOff(
        'Done.\n\nCheers,\nAnastasia\nCustomer Care · InstaRadar\nsupport@instaradar.app',
      ),
    ).toBe('Done.')
    expect(stripSignOff('Done.\n\nThank you,\nAnastasia')).toBe('Done.')
  })

  it('leaves bodies without a sign-off, or with real content after a closing word, alone', () => {
    const plain = 'Hi Tom,\n\nYour refund is on its way. Best of luck with the project!'
    expect(stripSignOff(plain)).toBe(plain)
    const longTail =
      'Hi,\n\nThanks,\nthe charge on September 21 is your regular Pro renewal and the earlier one is the retried August payment, so nothing was double billed.'
    expect(stripSignOff(longTail)).toBe(longTail)
  })
})
