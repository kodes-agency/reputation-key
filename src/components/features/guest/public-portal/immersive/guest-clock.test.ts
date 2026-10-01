// The guest page's clock: the server's instant at first, then that instant plus
// the time the page has been open, so a response refreshed after its deadline
// reads "the time has ended" and not a row that quietly disappears.

import { describe, expect, it } from 'vitest'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { PACKS } from './__fixtures__/immersive-response-fixtures'
import { advanceServedAt } from './guest-clock'
import { responseSectionRows } from './immersive-response-rows'

const SERVED_AT = '2026-09-30T09:00:00.000Z'

describe('advanceServedAt', () => {
  it('is the served instant itself when no time has passed, so SSR and the first render agree', () => {
    expect(advanceServedAt(SERVED_AT, 0)).toBe(SERVED_AT)
  })

  it('adds the time the page has been open', () => {
    expect(advanceServedAt(SERVED_AT, 6 * 60_000)).toBe('2026-09-30T09:06:00.000Z')
  })

  it('never goes back when the browser clock reads earlier than its start', () => {
    expect(advanceServedAt(SERVED_AT, -5_000)).toBe(SERVED_AT)
  })

  it('keeps the instant it was given when that is not a date', () => {
    expect(advanceServedAt('not a date', 1_000)).toBe('not a date')
  })
})

describe('a response refreshed after its change window', () => {
  const REFRESHED: GuestResponseView = {
    status: 'submitted',
    rating: 4,
    hasPrivateFeedback: false,
    privateFeedbackEligible: false,
    submittedAt: '2026-09-30T08:50:00.000Z',
    correctedAt: null,
    // The window ended a minute after the page was served.
    correctionDeadline: '2026-09-30T09:01:00.000Z',
    correctionAvailable: false,
    responseWithdrawalDeadline: '2026-10-01T11:32:00.000Z',
    responseWithdrawalAvailable: true,
    feedbackSubmittedAt: null,
    feedbackWithdrawalDeadline: null,
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: null,
    deletedAt: null,
  }

  it.each(PACKS)('says the time has ended on the open page [$locale]', (pack) => {
    const timeZone = 'Europe/Sofia'
    const stale = responseSectionRows(pack, REFRESHED, { now: SERVED_AT, timeZone })
    const advanced = responseSectionRows(pack, REFRESHED, {
      now: advanceServedAt(SERVED_AT, 6 * 60_000),
      timeZone,
    })

    // With the stale clock the row is thought "closed" and hidden.
    expect(stale.map((row) => row.id)).not.toContain('change')
    expect(advanced.find((row) => row.id === 'change')?.detail).toBe(
      pack.copy.windowEndedChange,
    )
  })
})
