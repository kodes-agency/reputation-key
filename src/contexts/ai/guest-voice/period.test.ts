import { describe, expect, it } from 'vitest'
import { guestVoicePeriod, buildGuestVoicePeriod } from './period.server'
import {
  input,
  review,
  population,
  groups,
} from '../application/read-models/guest-voice-v2.test-fixtures'
import type { PopulationChoice } from '../application/read-models/guest-voice-v2-population'
import type { GuestVoiceFactsRead } from '../application/ports/ai-guest-voice-facts.port'

const current = review(1, { localDate: '2026-10-15' })
const earlier = review(2, { localDate: '2026-07-31' })
const choice: PopulationChoice = {
  window: '90d',
  startLocalDate: '2026-08-02',
  coveredStartLocalDate: '2025-08-02',
  reviews: population([current, earlier]),
  hasBaseline: true,
  enough: true,
}
const facts: GuestVoiceFactsRead = {
  coverage: {
    expectedAnalysisCount: 2,
    settledAnalysisCount: 2,
    awaitingAnalysisCount: 0,
  },
  reviews: [current, earlier],
  unavailable: [],
  groups: [...groups.values()],
}

describe('Guest voice page and summary periods', () => {
  it('uses the preceding year as the baseline and shifts both windows for last week', () => {
    expect(guestVoicePeriod(choice, '2026-10-30')).toEqual({
      window: { startLocalDate: '2026-08-02', endLocalDate: '2026-10-30' },
      before: { startLocalDate: '2025-08-02', endLocalDate: '2026-08-01' },
    })
    expect(guestVoicePeriod(choice, '2026-10-30', 7)).toEqual({
      window: { startLocalDate: '2026-07-26', endLocalDate: '2026-10-23' },
      before: { startLocalDate: '2025-07-26', endLocalDate: '2026-07-25' },
    })
  })

  it('builds the same counted page for the page reader and the summary', () => {
    expect(
      buildGuestVoicePeriod(
        'property',
        choice,
        facts,
        guestVoicePeriod(choice, '2026-10-30'),
      ),
    ).toEqual(input([current], { baseline: [earlier] }))
  })

  it('never invents a baseline for a truncated population', () => {
    const truncated = { ...choice, hasBaseline: false }
    const period = guestVoicePeriod(truncated, '2026-10-30')
    expect(period.before).toBeNull()
    expect(buildGuestVoicePeriod('property', truncated, facts, period).baseline).toEqual(
      [],
    )
  })

  it('withholds stale revisions and marks unsettled current reviews provisional', () => {
    const stale = { ...facts, reviews: [{ ...current, sourceRevision: 2 }, earlier] }
    const built = buildGuestVoicePeriod(
      'property',
      choice,
      stale,
      guestVoicePeriod(choice, '2026-10-30'),
    )
    expect(built.current).toEqual([])
    expect(built.population.textReviews).toBe(1)
    expect(built.provisional).toBe(true)
  })
})
