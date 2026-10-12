import { describe, expect, it } from 'vitest'
import { formatInvitationDay } from './invitation-day'

describe('formatInvitationDay', () => {
  it('prints the UTC calendar day with a three-letter month', () => {
    expect(formatInvitationDay(new Date('2026-09-29T09:00:00Z'))).toBe('29 Sep 2026')
    expect(formatInvitationDay(new Date('2026-01-05T00:00:00Z'))).toBe('5 Jan 2026')
  })

  it('keeps the UTC day at the edge of the day, whatever zone the viewer is in', () => {
    expect(formatInvitationDay(new Date('2026-10-06T23:59:59Z'))).toBe('6 Oct 2026')
    expect(formatInvitationDay(new Date('2026-10-07T00:00:00Z'))).toBe('7 Oct 2026')
  })
})
