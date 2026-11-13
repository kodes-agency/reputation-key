import { describe, expect, it } from 'vitest'
import { representativeTimezone } from './notification-organization-scope.repository'

describe('representativeTimezone', () => {
  it('picks the modal timezone across the organization properties', () => {
    expect(
      representativeTimezone([
        { timezone: 'America/Denver' },
        { timezone: 'Europe/Sofia' },
        { timezone: 'Europe/Sofia' },
      ]),
    ).toBe('Europe/Sofia')
  })

  it('breaks a tie on the query order, so the answer is stable across sweeps', () => {
    // Query orders oldest property first; the first-seen zone wins a tie.
    expect(
      representativeTimezone([{ timezone: 'Europe/London' }, { timezone: 'Asia/Tokyo' }]),
    ).toBe('Europe/London')
  })

  it('returns null when the organization has no active property', () => {
    expect(representativeTimezone([])).toBeNull()
  })
})
