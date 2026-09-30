import { describe, expect, it } from 'vitest'
import type { PortalAnalyticsData } from '#/contexts/reporting/application/public-api'
import { resultsCells } from './portal-results-cells'
import {
  RESULTS_HEALTHY,
  resultsCount,
  resultsEvidence,
} from './portal-results-stories-data'

const cell = (
  data: PortalAnalyticsData,
  key: string,
  options: Readonly<{ compare: boolean }> = { compare: true },
) => resultsCells(data, options).find((candidate) => candidate.key === key)

describe('resultsCells on a healthy window', () => {
  it('names each measure for what it counts, in board order', () => {
    const labels = resultsCells(RESULTS_HEALTHY, { compare: true }).map(
      (candidate) => candidate.label,
    )

    expect(labels).toEqual([
      'Qualified scans',
      'Private ratings',
      'Average private rating',
      'Guests who opened Google',
      'Private notes',
    ])
  })

  it('compares qualified scans by the absolute change, against the named period', () => {
    expect(cell(RESULTS_HEALTHY, 'scans')).toMatchObject({
      value: '412',
      detail: '+31 vs the 30 days before',
    })
  })

  it('gives ratings and Google opens as a share of qualified scans', () => {
    expect(cell(RESULTS_HEALTHY, 'ratings')).toMatchObject({
      value: '118',
      detail: '29% of scans',
    })
    expect(cell(RESULTS_HEALTHY, 'googleOpens')).toMatchObject({
      value: '64',
      detail: '16% of scans',
    })
  })

  it('states the sample behind the average, and its comparison in stars', () => {
    expect(cell(RESULTS_HEALTHY, 'average')).toMatchObject({
      value: '4.4',
      unit: 'star',
      detail: 'from 118 · +0.1',
    })
  })

  it('compares private notes by the absolute change', () => {
    expect(cell(RESULTS_HEALTHY, 'notes')).toMatchObject({
      value: '9',
      detail: '+2 vs the 30 days before',
    })
  })
})

describe('resultsCells: signs and the comparison toggle', () => {
  it('writes a fall with a true minus sign, and no change in words', () => {
    const fell = {
      ...RESULTS_HEALTHY,
      kpis: { ...RESULTS_HEALTHY.kpis, scans: resultsCount(400, 412) },
    }
    const flat = {
      ...RESULTS_HEALTHY,
      kpis: { ...RESULTS_HEALTHY.kpis, scans: resultsCount(412, 412) },
    }

    expect(cell(fell, 'scans')?.detail).toBe('−12 vs the 30 days before')
    expect(cell(flat, 'scans')?.detail).toBe('No change vs the 30 days before')
  })

  it('drops every comparison when the toggle is off, keeping the shares', () => {
    const off = { compare: false }

    expect(cell(RESULTS_HEALTHY, 'scans', off)?.detail).toBeNull()
    expect(cell(RESULTS_HEALTHY, 'notes', off)?.detail).toBeNull()
    expect(cell(RESULTS_HEALTHY, 'ratings', off)?.detail).toBe('29% of scans')
    expect(cell(RESULTS_HEALTHY, 'average', off)?.detail).toBe('from 118')
  })

  it('says a prior period before the measure began has no figure to compare', () => {
    const early = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        scans: {
          ...resultsCount(412, null),
          priorUnavailableReason: 'measure_not_yet_counted' as const,
        },
      },
    }

    expect(cell(early, 'scans')?.detail).toBe('The period before predates this measure')
  })
})

describe('resultsCells: honest about what it cannot say', () => {
  it('never prints a share over 100%: more ratings than scans falls back to the change', () => {
    const more = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        scans: resultsCount(100, 90),
        ratings: resultsCount(118, 103),
      },
    }

    expect(cell(more, 'ratings')?.detail).toBe('+15 vs the 30 days before')
  })

  it('shows no average below the floor and says how many ratings there are', () => {
    const few = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        avgRating: {
          value: null,
          priorValue: null,
          comparison: null,
          sampleCount: 4,
          priorSampleCount: 0,
          evidence: resultsEvidence({
            state: 'insufficient_data',
            availabilityReason: 'below_minimum_sample',
            verifiedThrough: null,
            sampleCount: 4,
          }),
        },
      },
    }

    expect(cell(few, 'average')).toMatchObject({
      value: '—',
      unit: null,
      detail: '4 ratings, needs 5 to show an average',
    })
  })

  it('says why a comparison is withheld, from the server, with no floor of its own', () => {
    const small = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        avgRating: {
          ...RESULTS_HEALTHY.kpis.avgRating,
          comparison: null,
          comparisonWithheld: 'sample_too_small' as const,
        },
      },
    }

    expect(cell(small, 'average')?.detail).toBe('from 118 · too few to compare')
  })

  it('leaves a figure that is not ready as a dash with the reason', () => {
    const updating = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        scans: {
          value: null,
          priorValue: null,
          trend: null,
          evidence: resultsEvidence({
            state: 'updating',
            verifiedThrough: null,
            availabilityReason: 'consumer_receipt_pending',
          }),
        },
      },
    }

    expect(cell(updating, 'scans')).toMatchObject({
      value: '—',
      detail: 'Recent activity is still processing.',
    })
    // Shares cannot be stated over a scan count that is not known.
    expect(cell(updating, 'ratings')?.detail).toBe('+15 vs the 30 days before')
  })

  it('says Google opens cannot be counted when clicks never recorded their link', () => {
    const unattributed = {
      ...RESULTS_HEALTHY,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        googleOpens: {
          value: null,
          priorValue: null,
          trend: null,
          evidence: resultsEvidence({
            state: 'insufficient_data',
            availabilityReason: 'destination_unattributed',
            verifiedThrough: null,
          }),
        },
      },
    }

    expect(cell(unattributed, 'googleOpens')).toMatchObject({ value: '—' })
    expect(cell(unattributed, 'googleOpens')?.detail).toMatch(/did not record which link/)
  })

  it('reads All Time without a comparison or a share it cannot back', () => {
    const all = {
      ...RESULTS_HEALTHY,
      localDays: null,
      comparePeriod: null,
      kpis: {
        ...RESULTS_HEALTHY.kpis,
        scans: resultsCount(412, null),
        feedback: resultsCount(9, null),
      },
    }

    expect(cell(all, 'scans')?.detail).toBeNull()
    expect(cell(all, 'notes')?.detail).toBeNull()
  })
})
