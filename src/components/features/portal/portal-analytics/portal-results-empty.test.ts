import { describe, expect, it } from 'vitest'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { emptyResults } from './portal-results-empty'
import {
  RESULTS_HEALTHY,
  resultsCount,
  resultsEvidence,
} from './portal-results-stories-data'

const NOTHING = {
  scans: resultsCount(0, 0),
  ratings: resultsCount(0, 0),
  avgRating: {
    value: null,
    priorValue: null,
    comparison: null,
    sampleCount: 0,
    priorSampleCount: 0,
    evidence: resultsEvidence({ state: 'insufficient_data' }),
  },
  feedback: resultsCount(0, 0),
  googleOpens: resultsCount(0, 0),
} as const

const ZERO_INTEGRITY = {
  accepted: 0,
  filteredAutomatically: 0,
  underReview: 0,
  total: 0,
}

/** A window with no figures; `prior` is what the period before had. */
function quiet(prior: Partial<Record<'scans' | 'notes', number>> = {}) {
  return {
    ...RESULTS_HEALTHY,
    kpis: {
      ...NOTHING,
      scans: resultsCount(0, prior.scans ?? 0),
      feedback: resultsCount(0, prior.notes ?? 0),
    },
    responseIntegrity: ZERO_INTEGRITY,
  } satisfies PortalAnalyticsData
}

const live = { comparing: true, isLive: true }

describe('emptyResults', () => {
  it('has nothing to say while there are figures', () => {
    expect(emptyResults(RESULTS_HEALTHY, live)).toBeNull()
  })

  it('has nothing to say while a figure is still being counted', () => {
    const counting = {
      ...quiet(),
      kpis: {
        ...NOTHING,
        scans: {
          ...resultsCount(0, 0),
          value: null,
          evidence: resultsEvidence({ state: 'updating' }),
        },
      },
    } as unknown as PortalAnalyticsData
    expect(emptyResults(counting, live)).toBeNull()
  })

  it('keeps the strip for a quiet window on a live portal and names the drop', () => {
    expect(emptyResults(quiet({ scans: 40 }), live)).toEqual({
      kind: 'quiet',
      line: 'No scans in these 30 days (40 in the 30 days before). Check the printed code is still in place.',
    })
  })

  it('says it in the singular for a one-day window', () => {
    const day = {
      ...quiet({ scans: 3 }),
      localDays: {
        start: '2026-09-30',
        end: '2026-09-30',
        compareStart: '2026-09-29',
        compareEnd: '2026-09-29',
      },
    }
    expect(emptyResults(day, live)).toEqual({
      kind: 'quiet',
      line: 'No scans on this day (3 the day before). Check the printed code is still in place.',
    })
  })

  it('still calls a window quiet when only notes were left in the period before', () => {
    expect(emptyResults(quiet({ notes: 2 }), live)).toEqual({
      kind: 'quiet',
      line: 'Nothing was recorded in these 30 days, but there was activity in the 30 days before. Check the printed code is still in place.',
    })
  })

  it('does not guess at history it did not read: a window with the comparison off', () => {
    expect(emptyResults(quiet({ scans: 40 }), { ...live, comparing: false })).toEqual({
      kind: 'nothing',
      title: 'Nothing recorded in these 30 days',
      description:
        'No scans, ratings or notes in this period. If the code is out already, check it is still in place.',
    })
  })

  it('is the first-run panel when the period before was empty too', () => {
    expect(emptyResults(quiet(), live)).toMatchObject({
      kind: 'nothing',
      title: 'Nothing recorded in these 30 days',
    })
  })

  it('is the first-run panel for All Time, which has no period before', () => {
    const all = { ...quiet(), localDays: null, comparePeriod: null }
    expect(emptyResults(all, { comparing: false, isLive: true })).toEqual({
      kind: 'nothing',
      title: 'No data yet',
      description: 'Results appear once guests start scanning this portal’s code.',
    })
  })

  it('waits for publishing when the portal is not live', () => {
    expect(emptyResults(quiet(), { comparing: true, isLive: false })).toEqual({
      kind: 'draft',
    })
  })

  it('keeps the figures of a portal that is not live now but had visitors', () => {
    expect(emptyResults(RESULTS_HEALTHY, { comparing: true, isLive: false })).toBeNull()
  })
})
