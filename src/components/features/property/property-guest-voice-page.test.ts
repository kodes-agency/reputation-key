import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type {
  AiPropertyInsightsPresetReady,
  AiTrendSupportingReviewView,
} from '#/contexts/ai/application/public-api'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import {
  PropertyGuestVoiceBasis,
  TrendSupportingReviews,
} from './property-guest-voice-page'

const DISAGREEING_SOURCE_FIELDS: AiPropertyInsightsPresetReady = {
  status: 'ready',
  provisional: true,
  coverage: {
    settledAnalysisCount: 10,
    expectedAnalysisCount: 10,
    awaitingAnalysisCount: 0,
  },
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  dataThroughLocalDate: '2026-09-10',
  impactVersion: 'aspect-impact-v1',
  aspectEvidenceState: 'available',
  basis: {
    reviewCount: 39,
    analyzedReviewCount: 10,
    preAspectAnalysisCount: 5,
    currentAnalysisCount: 18,
    starOnlyCount: 12,
    notAnalyzableCount: 3,
    awaitingAnalysisCount: 9,
    ratingDistribution: [
      { stars: 1, count: 3 },
      { stars: 2, count: 4 },
      { stars: 3, count: 6 },
      { stars: 4, count: 11 },
      { stars: 5, count: 15 },
    ],
  },
  aspects: [],
  weeklyAspectSeries: [],
  emergingIssues: [],
}

describe('PropertyGuestVoiceBasis', () => {
  it('uses the basis counter for both filling-in status and its breakdown', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, { result: DISAGREEING_SOURCE_FIELDS }),
    )

    expect(markup).toContain('Based on 39 reviews · 10 analysed')
    expect(markup).toContain('9 reviews still being analysed')
    expect(markup).toMatch(/<dt>Awaiting analysis<\/dt><dd[^>]*>9<\/dd>/)
    expect(markup).not.toContain('0 reviews still being analysed')
    expect(markup).not.toMatch(/<dt>Awaiting analysis<\/dt><dd[^>]*>0<\/dd>/)
  })
})

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const OPENABLE_REVIEW = reviewId('00000000-0000-4000-8000-000000000021')
const UNOPENABLE_REVIEW = reviewId('00000000-0000-4000-8000-000000000022')
const INBOX_ITEM = inboxItemId('00000000-0000-4000-8000-000000000031')

const SUPPORTING_REVIEWS: readonly AiTrendSupportingReviewView[] = [
  {
    reviewId: OPENABLE_REVIEW,
    window: 'current',
    localDate: '2026-09-08',
    inboxItemId: INBOX_ITEM,
  },
  {
    reviewId: UNOPENABLE_REVIEW,
    window: 'baseline',
    localDate: '2026-08-02',
    inboxItemId: null,
  },
]

/** The real router Link needs a router to build its href; none of its routes load. */
function renderSupportingReviews(reviews: readonly AiTrendSupportingReviewView[]) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(TrendSupportingReviews, {
        propertyId: PROPERTY_ID,
        reviews,
      }),
    }),
  )
}

describe('TrendSupportingReviews', () => {
  it('opens a supporting review by the Inbox item selector the reviews route reads', () => {
    const markup = renderSupportingReviews(SUPPORTING_REVIEWS)

    // `itemId` is the reviews route's item selector; a `reviewId` key is
    // stripped by its search schema and opened nothing.
    expect(markup).toContain(
      `href="/properties/${PROPERTY_ID}/reviews?itemId=${INBOX_ITEM}"`,
    )
    expect(markup).toContain(
      'aria-label="Open supporting review from 8 Sept 2026 in the inbox"',
    )
    expect(markup).not.toContain('reviewId=')
  })

  it('shows a supporting review with no openable item as text, never a dead link', () => {
    const markup = renderSupportingReviews(SUPPORTING_REVIEWS)

    expect(markup.match(/<a /g)).toHaveLength(1)
    expect(markup).toMatch(/<span[^>]*>Previous period · 2 Aug 2026<\/span>/)
  })

  it('renders nothing when the trend cites no review', () => {
    expect(renderSupportingReviews([])).toBe('')
  })
})
