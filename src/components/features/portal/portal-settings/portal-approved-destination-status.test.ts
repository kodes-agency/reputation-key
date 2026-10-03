import { describe, expect, it } from 'vitest'
import { APPROVED_DESTINATION_STATUS } from './portal-approved-destination-status'

describe('the approval state of a link destination', () => {
  it('reads as words a manager would say, never as the stored token', () => {
    for (const [state, presentation] of Object.entries(APPROVED_DESTINATION_STATUS)) {
      expect(presentation.label).not.toBe(state)
      expect(presentation.label).toMatch(/^[A-Z]/u)
    }
  })

  it.each([
    ['approved', 'Approved', 'positive'],
    ['pending', 'Waiting for approval', 'warn'],
    ['disabled', 'Disabled', 'neutral'],
    ['quarantined', 'Quarantined', 'negative'],
  ] as const)('%s is "%s" in the %s tone', (state, label, tone) => {
    expect(APPROVED_DESTINATION_STATUS[state]).toEqual({ label, tone })
  })
})
