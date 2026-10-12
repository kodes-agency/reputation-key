import { describe, expect, it } from 'vitest'
import { INVITATION_STATUS } from './invitation-status'

describe('an invitation status', () => {
  it('reads as a word, never as the stored token', () => {
    for (const [status, presentation] of Object.entries(INVITATION_STATUS)) {
      expect(presentation.label).not.toBe(status)
      expect(presentation.label).toMatch(/^[A-Z]/u)
    }
  })

  it.each([
    ['pending', 'Pending', 'neutral'],
    ['expired', 'Expired', 'warn'],
    ['accepted', 'Accepted', 'positive'],
    ['rejected', 'Declined', 'negative'],
    ['canceled', 'Canceled', 'neutral'],
  ] as const)('%s is "%s" in the %s tone', (status, label, tone) => {
    expect(INVITATION_STATUS[status]).toEqual({ label, tone })
  })
})
