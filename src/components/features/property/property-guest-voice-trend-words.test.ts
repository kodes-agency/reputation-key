import { describe, expect, it } from 'vitest'
import type { AiTrendReportView } from '#/contexts/ai/application/public-api'
import { describeTrend } from './property-guest-voice-trend-words'

type TrendWindow = Extract<AiTrendReportView, { status: 'ready' }>['evidence']['current']

function trendWindow(
  startLocalDate: string,
  endLocalDate: string,
  textCandidateCount: number,
  analyzedCount: number,
): TrendWindow {
  return {
    period: { startLocalDate, endLocalDate },
    textCandidateCount,
    analyzedCount,
    excludedCount: textCandidateCount - analyzedCount,
    starOnlyCount: 0,
    coverageBasisPoints:
      textCandidateCount === 0
        ? 0
        : Math.floor((analyzedCount * 10_000) / textCandidateCount),
  }
}

function evidence(
  baseline: [number, number],
  current: [number, number],
  supportingReviews: readonly never[] = [],
) {
  return {
    definitionVersion: 'property-trend-definition-v1',
    definitionDigest: 'a'.repeat(64),
    renderProfileVersion: 'trend-render-v1',
    renderProfileDigest: 'b'.repeat(64),
    timezone: 'Europe/Sofia',
    dataThroughLocalDate: '2026-09-10',
    baseline: trendWindow('2026-07-13', '2026-08-11', ...baseline),
    current: trendWindow('2026-08-12', '2026-09-10', ...current),
    modelLineage: [],
    selectedSignals: [],
    supportingReviews,
  }
}

const EPOCHS = {
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
} as const

const FINISHED = {
  ...EPOCHS,
  dueLocalDate: '2026-09-11',
  terminalAnalysisSequence: 24,
  aggregateRevision: 24,
  updating: false,
} as const

describe('describeTrend', () => {
  it('has nothing to say when the comparison is off', () => {
    expect(describeTrend({ status: 'disabled' })).toBeNull()
  })

  it('says the comparison is being prepared while there is nothing to count yet', () => {
    expect(describeTrend({ status: 'preparing', ...EPOCHS })).toEqual({
      kind: 'state',
      text: 'The comparison with the month before is being prepared.',
      sample: null,
    })
  })

  it('says Updating without evidence in words, not as a blank', () => {
    expect(describeTrend({ status: 'updating', ...EPOCHS })).toMatchObject({
      kind: 'state',
      text: 'Still analysing your reviews. The comparison with the month before appears when most are done.',
      sample: null,
    })
  })

  it('counts the reviews done of the reviews to do while a window is still being analysed', () => {
    expect(
      describeTrend({
        status: 'updating',
        ...EPOCHS,
        evidence: evidence([22, 20], [20, 14]),
      }),
    ).toEqual({
      kind: 'state',
      text: 'Still analysing: 34 of 42 reviews done.',
      sample: null,
    })
  })

  it('does not call a window that has no text review "still analysing": 0 of 0 waits for nothing', () => {
    const words = describeTrend({
      status: 'updating',
      ...EPOCHS,
      evidence: evidence([0, 0], [2, 2]),
    })

    expect(words?.text).toBe(
      'Not enough reviews yet to compare months: 0 of the 20 needed in the 30 days before.',
    )
    expect(words?.text).not.toMatch(/Still analysing/)
  })

  it('says how many reviews the shorter window has of the 20 it needs', () => {
    expect(
      describeTrend({
        ...FINISHED,
        status: 'insufficient_data',
        evidence: evidence([22, 22], [14, 14]),
      }),
    ).toEqual({
      kind: 'state',
      text: 'Not enough reviews yet to compare months: 14 of the 20 needed in the last 30 days.',
      sample: 'Reviews analysed: 14 in the last 30 days, 22 in the 30 days before.',
    })
  })

  it('names the earlier window when that is the one with too few', () => {
    expect(
      describeTrend({
        ...FINISHED,
        status: 'insufficient_data',
        evidence: evidence([7, 7], [31, 31]),
      })?.text,
    ).toBe(
      'Not enough reviews yet to compare months: 7 of the 20 needed in the 30 days before.',
    )
  })

  it('says nothing clearly changed, with the reviews it compared', () => {
    expect(
      describeTrend({
        ...FINISHED,
        status: 'no_material_change',
        evidence: evidence([22, 22], [20, 20]),
      }),
    ).toEqual({
      kind: 'state',
      text: 'No clear change in the last 30 days.',
      sample:
        'Compared 20 reviews from the last 30 days with 22 from the 30 days before.',
    })
  })

  it('keeps the finding of a ready comparison and adds the reviews it rests on', () => {
    expect(
      describeTrend({
        ...FINISHED,
        status: 'ready',
        reportProfileVersion: 'property-trend-v1',
        report: {
          signalKey: 'aspect.service.negative.down',
          direction: 'improving',
          changeMagnitudeBasisPoints: 1_500,
          supportingReviewCount: 10,
          headline: 'Review signals improved',
          sentences: ['Service complaints fell from 30.0% to 15.0%'],
          summary: 'Service complaints fell from 30.0% to 15.0%.',
        },
        evidence: evidence([22, 22], [20, 20]),
        generatedAtEpochMillis: 0,
      }),
    ).toEqual({
      kind: 'report',
      text: 'Service complaints fell from 30.0% to 15.0%.',
      sample: 'Based on 20 reviews from the last 30 days and 22 from the 30 days before.',
    })
  })

  it('reads the number of days from the windows themselves', () => {
    const short = evidence([22, 22], [20, 20])
    const words = describeTrend({
      ...FINISHED,
      status: 'no_material_change',
      evidence: {
        ...short,
        current: {
          ...short.current,
          period: { startLocalDate: '2026-08-28', endLocalDate: '2026-09-10' },
        },
      },
    })

    expect(words?.text).toBe('No clear change in the last 14 days.')
  })

  it('says singular for one review', () => {
    expect(
      describeTrend({
        ...FINISHED,
        status: 'no_material_change',
        evidence: evidence([22, 22], [1, 1]),
      })?.sample,
    ).toBe('Compared 1 review from the last 30 days with 22 from the 30 days before.')
  })
})
