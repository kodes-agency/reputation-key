import { describe, expect, it } from 'vitest'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import type { AiTrendEvidence, AiTrendReportRead } from './ports/ai-output-store.port'
import {
  trendSupportingReviewIds,
  withSupportingReviewItems,
  type AiTrendReportView,
} from './trend-report-view'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000011'
const CURRENT_REVIEW = reviewId('00000000-0000-4000-8000-000000000021')
const BASELINE_REVIEW = reviewId('00000000-0000-4000-8000-000000000022')
const CURRENT_ITEM = inboxItemId('00000000-0000-4000-8000-000000000031')

const EPOCHS = {
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
} as const

const WINDOW = {
  textCandidateCount: 20,
  analyzedCount: 20,
  excludedCount: 0,
  starOnlyCount: 0,
  coverageBasisPoints: 10_000,
} as const

const EVIDENCE: AiTrendEvidence = {
  definitionVersion: 'property-trend-definition-v1',
  definitionDigest: 'a'.repeat(64),
  renderProfileVersion: 'trend-render-v1',
  renderProfileDigest: 'b'.repeat(64),
  timezone: 'UTC',
  dataThroughLocalDate: '2026-08-19',
  baseline: {
    period: { startLocalDate: '2026-06-21', endLocalDate: '2026-07-20' },
    ...WINDOW,
  },
  current: {
    period: { startLocalDate: '2026-07-21', endLocalDate: '2026-08-19' },
    ...WINDOW,
  },
  modelLineage: [],
  selectedSignals: [],
  supportingReviews: [
    {
      reviewId: CURRENT_REVIEW,
      window: 'current',
      localDate: '2026-08-02',
      href: `/properties/${PROPERTY_ID}/reviews?reviewId=${CURRENT_REVIEW}`,
    },
    {
      reviewId: BASELINE_REVIEW,
      window: 'baseline',
      localDate: '2026-07-01',
      href: `/properties/${PROPERTY_ID}/reviews?reviewId=${BASELINE_REVIEW}`,
    },
  ],
}

const READY: Extract<AiTrendReportRead, { status: 'ready' }> = {
  status: 'ready',
  ...EPOCHS,
  dueLocalDate: '2026-08-20',
  terminalAnalysisSequence: 40,
  aggregateRevision: 40,
  reportProfileVersion: 'property-trend-v1',
  report: {
    signalKey: 'aspect.service.negative.down',
    direction: 'improving',
    changeMagnitudeBasisPoints: 1_500,
    supportingReviewCount: 2,
    headline: 'Review signals improved',
    sentences: ['Service complaints fell from 30.0% to 15.0%'],
    summary: 'Service complaints fell from 30.0% to 15.0%.',
  },
  evidence: EVIDENCE,
  updating: false,
  generatedAtEpochMillis: 0,
}

const ITEMS = new Map([[CURRENT_REVIEW, CURRENT_ITEM]])

function readyView(
  view: AiTrendReportView,
): Extract<AiTrendReportView, { status: 'ready' }> {
  if (view.status !== 'ready') {
    throw new Error(`expected a ready view, got ${view.status}`)
  }
  return view
}

describe('trendSupportingReviewIds', () => {
  it('lists the cited Reviews in evidence order', () => {
    expect(trendSupportingReviewIds(READY)).toEqual([CURRENT_REVIEW, BASELINE_REVIEW])
  })

  it.each<[string, AiTrendReportRead]>([
    ['disabled', { status: 'disabled' }],
    ['preparing', { status: 'preparing', ...EPOCHS }],
    ['updating without evidence', { status: 'updating', ...EPOCHS }],
  ])('cites no Review when the read is %s', (_label, read) => {
    expect(trendSupportingReviewIds(read)).toEqual([])
  })
})

describe('withSupportingReviewItems', () => {
  it('names the Inbox Item that opens each supporting review, or none', () => {
    const view = readyView(withSupportingReviewItems(READY, ITEMS))

    expect(view.evidence.supportingReviews).toEqual([
      {
        reviewId: CURRENT_REVIEW,
        window: 'current',
        localDate: '2026-08-02',
        inboxItemId: CURRENT_ITEM,
      },
      {
        reviewId: BASELINE_REVIEW,
        window: 'baseline',
        localDate: '2026-07-01',
        inboxItemId: null,
      },
    ])
  })

  it('delivers no stored href, which is not a working route', () => {
    const view = withSupportingReviewItems(READY, ITEMS)

    expect(JSON.stringify(view)).not.toContain('reviewId=')
  })

  it('leaves every other field of the read as stored, and the stored read unchanged', () => {
    const { evidence: viewEvidence, ...viewRest } = readyView(
      withSupportingReviewItems(READY, ITEMS),
    )
    const { evidence: readEvidence, ...readRest } = READY

    expect(viewRest).toEqual(readRest)
    expect({ ...viewEvidence, supportingReviews: [] }).toEqual({
      ...readEvidence,
      supportingReviews: [],
    })
    expect(READY.evidence.supportingReviews[0]).toHaveProperty('href')
  })

  it('resolves the supporting reviews an updating read already carries', () => {
    const view = withSupportingReviewItems(
      { status: 'updating', ...EPOCHS, evidence: EVIDENCE },
      ITEMS,
    )
    if (view.status !== 'updating') {
      throw new Error(`expected an updating view, got ${view.status}`)
    }

    expect(view.evidence?.supportingReviews.map((review) => review.inboxItemId)).toEqual([
      CURRENT_ITEM,
      null,
    ])
  })

  it.each<[string, AiTrendReportRead]>([
    ['disabled', { status: 'disabled' }],
    ['preparing', { status: 'preparing', ...EPOCHS }],
    ['updating without evidence', { status: 'updating', ...EPOCHS }],
  ])('delivers a %s read as it is', (_label, read) => {
    expect(withSupportingReviewItems(read, ITEMS)).toEqual(read)
  })
})
