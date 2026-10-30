import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import type {
  AiPropertyInsightsPresetReady,
  AiTrendSupportingReviewView,
} from '#/contexts/ai/application/public-api'
import { inboxItemId, reviewId } from '#/shared/domain/ids'
import { PropertyGuestVoiceBasis } from './property-guest-voice-basis'
import { RANGE_CONTROL_LABEL } from '#/components/ui/range-control'
import { PropertyGuestVoicePage } from './property-guest-voice-page'
import { TrendSupportingReviews } from './property-guest-voice-trend'
import { PropertyInsightsRecurringIssues } from './property-insights-recurring-issues'
import { HAMPTON_READ } from './guest-voice/guest-voice-fixtures-check-in'
import { LARGE_PROPERTY } from './property-guest-voice-stories-data'

// The AI-off state offers the account admin's button, which asks who may manage AI.
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

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
  window: { selection: 'chosen', textReviewCount: 27 },
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

  it('names the window and what it holds before the figures that depend on it', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, { result: LARGE_PROPERTY }),
    )

    expect(markup).toContain(
      'Last 90 days, chosen because it holds 128 reviews with text.',
    )
    expect(markup.indexOf('chosen because')).toBeLessThan(markup.indexOf('Based on'))
  })

  it('says why the rows count fewer reviews than the window holds, next to the window', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, { result: LARGE_PROPERTY }),
    )

    expect(markup).toContain(
      '120 of them analysed; 8 in a language we don&#x27;t analyse yet.',
    )
    expect(markup.indexOf('chosen because')).toBeLessThan(markup.indexOf('120 of them'))
    expect(markup.indexOf('120 of them')).toBeLessThan(markup.indexOf('Based on'))
  })

  it('has nothing to explain when every review with text was read', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, {
        result: {
          ...LARGE_PROPERTY,
          window: {
            selection: 'automatic',
            textReviewCount: 120,
            enoughForPatterns: true,
          },
          basis: { ...LARGE_PROPERTY.basis, notAnalyzableCount: 0 },
        },
      }),
    )

    expect(markup).not.toContain('of them analysed')
  })

  it('lists the days the window covers among the figures behind it', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyGuestVoiceBasis, { result: LARGE_PROPERTY }),
    )

    expect(markup).toMatch(/<dt>Period<\/dt><dd[^>]*>Jun 13, 2026 to Sep 10, 2026<\/dd>/)
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
      'aria-label="Open supporting review from Sep 8, 2026 in the inbox"',
    )
    expect(markup).not.toContain('reviewId=')
  })

  it('shows a supporting review with no openable item as text, never a dead link', () => {
    const markup = renderSupportingReviews(SUPPORTING_REVIEWS)

    expect(markup.match(/<a /g)).toHaveLength(1)
    expect(markup).toMatch(/<span[^>]*>Previous period · Aug 2, 2026<\/span>/)
  })

  it('renders nothing when the trend cites no review', () => {
    expect(renderSupportingReviews([])).toBe('')
  })
})

describe('PropertyInsightsRecurringIssues', () => {
  it('lists the issues two or more reviews name, with how many reviews', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsRecurringIssues, { evidence: LARGE_PROPERTY }),
    )

    expect(markup).toContain('front desk delays')
    expect(markup).toMatch(/<span class="font-semibold">12<\/span> reviews/)
    expect(markup).not.toContain('compared with the previous period')
  })

  it('says no issue was named in more than one review when there are none', () => {
    const markup = renderToStaticMarkup(
      createElement(PropertyInsightsRecurringIssues, {
        evidence: { ...LARGE_PROPERTY, emergingIssues: [] },
      }),
    )

    expect(markup).toContain('No issue was named in more than one review in this period.')
  })
})

// S3 (switch-on): where there is no page yet, the page says why and offers no window to
// choose, and reads nothing of the analysis that was drawn from v2.
function renderPage(state: 'disabled' | 'preparing') {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PropertyGuestVoicePage, {
        propertyId: PROPERTY_ID,
        propertyName: 'Hotel',
        range: 'auto',
        onRangeChange: () => undefined,
        state,
      }),
    }),
  )
}

describe('PropertyGuestVoicePage without a page to draw', () => {
  it('says AI analysis is off, with no window to choose', () => {
    const markup = renderPage('disabled')

    expect(markup).toContain('AI analysis is off for this property')
    expect(markup).not.toContain(RANGE_CONTROL_LABEL)
  })

  it('says the analysis is being prepared, with no window to choose', () => {
    const markup = renderPage('preparing')

    expect(markup).toContain('Guest voice is being prepared')
    expect(markup).not.toContain(RANGE_CONTROL_LABEL)
  })
})

it('renders the actual shared range inside PageHeader actions and the resolved caption', () => {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const html = renderToStaticMarkup(
    createElement(RouterContextProvider, {
      router,
      children: createElement(PropertyGuestVoicePage, {
        propertyId: PROPERTY_ID,
        propertyName: 'Hotel',
        range: 'auto',
        onRangeChange: () => undefined,
        v2: { read: HAMPTON_READ },
      }),
    }),
  )
  const actions = /data-slot="page-header-actions"[^>]*>([\s\S]*?)<\/div><\/div>/u.exec(
    html,
  )?.[1]
  expect(actions).toContain('Time range')
  expect(actions).toContain('Last 12 months')
  expect(actions).toContain('132 reviews')
  expect(html).not.toContain('page-header-meta')
})
