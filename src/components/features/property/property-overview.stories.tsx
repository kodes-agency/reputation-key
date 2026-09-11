// Dashboard → Overview. Four rows, one screen, no charts.
//
// The four states the redesign requires of every dashboard page (ready, week
// one, filling in, unavailable) are stories here, at 1440 and 390 px. Week one
// is the state every property passes through and the one the old page failed
// hardest: four of its first six numbers were dashes with audit lines under
// them. The rule these stories enforce is row 12 — a number where there is one,
// otherwise one sentence and one action, never a dash.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import type { DashboardData } from '#/contexts/reporting/application/public-api'
import type { getPropertyGooglePerformance } from '#/contexts/integration/server/google-performance'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import { reviewId } from '#/shared/domain/ids'
import { PropertyOverview } from './property-overview'
import {
  activeSignals,
  calmSignals,
  noDataDashboard,
  populatedDashboard,
  property,
} from './property-dashboard-stories-data'

// A lease that renews: `{ ok: false }` makes the hook clear the report as an
// authorization loss, which is correct behaviour and the wrong fixture here.
const renewLease = (async (input: { data: { leaseRef: string } }) => ({
  ok: true as const,
  lease: {
    leaseRef: input.data.leaseRef,
    expiresAt: '2030-08-12T12:20:30.000Z',
    ttlSeconds: 30,
    renewAfterMs: 10_000 as const,
  },
})) as never

const googleUnavailable = {
  getPerformance: (async () => ({
    status: 'unavailable',
    reason: 'disconnected',
    action: 'open_integrations',
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease,
}

function metric(value: number | null, deltaPercent: number | null) {
  return {
    label: 'Total profile impressions',
    value,
    priorValue: null,
    deltaPercent,
    availability: 'ready' as const,
    completeDayCount: 30,
    priorCompleteDayCount: 30,
  }
}

const googleReady = {
  getPerformance: (async () => ({
    status: 'ready',
    data: {
      contractVersion: 1,
      catalogVersion: '2026-08-05',
      sourceLabel: 'Google Business Profile',
      retrievedAt: '2026-08-12T12:20:00.000Z',
      contentExpiresAt: '2030-08-12T12:35:00.000Z',
      contentTtlSeconds: 900,
      authorizationLease: {
        leaseRef: 'v1.performance-30d',
        expiresAt: '2030-08-12T12:20:30.000Z',
        ttlSeconds: 30,
        renewAfterMs: 10_000 as const,
      },
      period: {
        preset: '30d',
        timezone: 'Europe/Sofia',
        currentStartLocalDate: '2026-06-01',
        currentEndLocalDate: '2026-06-30',
        priorStartLocalDate: '2026-05-02',
        priorEndLocalDate: '2026-05-31',
      },
      sourceHealth: {
        state: 'ready',
        providerCheckedThroughLocalDate: '2026-06-30',
        latestReturnedDataLocalDate: '2026-06-30',
        latestCompleteCoreLocalDate: '2026-06-30',
        dataLagDays: 0,
      },
      headlines: {
        totalProfileImpressions: metric(1_190, -19.5),
        websiteClicks: metric(17, -37),
        callClicks: metric(15, -28.6),
        directionRequests: metric(50, -38.3),
      },
      discoverySeries: [],
      actionSeries: [],
      additionalInteractions: [],
    },
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease,
}

const aiReady = {
  getTrend: (async () => ({
    status: 'ready',
    report: { headline: 'Staff praised more often this month' },
  })) as unknown as typeof getPropertyAiTrendFn,
  getAggregates: (async () => ({
    status: 'ready',
    provisional: false,
    coverage: {
      settledAnalysisCount: 48,
      expectedAnalysisCount: 48,
      awaitingAnalysisCount: 0,
    },
    startLocalDate: '2026-06-01',
    endLocalDate: '2026-06-30',
    reviewCount: 48,
    analyzedReviewCount: 48,
    preAspectAnalysisCount: 0,
    impactVersion: 'aspect-impact-v1',
    aspects: [
      { aspect: 'staff', polarity: 'positive', mentionCount: 11, impact: 7.1 },
      { aspect: 'parking', polarity: 'negative', mentionCount: 4, impact: -2.8 },
    ],
    emergingIssues: [],
    sentimentByDay: [],
    sentimentTotals: { positive: 30, neutral: 10, negative: 6, mixed: 2 },
  })) as unknown as typeof getPropertyAiAggregatesFn,
}

const aiOff = {
  getTrend: (async () => ({
    status: 'disabled',
  })) as unknown as typeof getPropertyAiTrendFn,
  getAggregates: (async () => ({
    status: 'disabled',
  })) as unknown as typeof getPropertyAiAggregatesFn,
}

const aiPreparing = {
  getTrend: (async () => ({
    status: 'preparing',
  })) as unknown as typeof getPropertyAiTrendFn,
  getAggregates: (async () => ({
    status: 'preparing',
  })) as unknown as typeof getPropertyAiAggregatesFn,
}

/** Week one: two reviews, both this month, no Google, no AI. */
const weekOne: DashboardData = {
  ...noDataDashboard,
  kpis: {
    ...noDataDashboard.kpis,
    reviews: { value: 2, priorValue: 0, trend: null },
    avgRating: {
      value: 5,
      priorValue: null,
      comparison: null,
      sampleCount: 2,
      priorSampleCount: 0,
      evidence: populatedDashboard.kpis.avgRating.evidence,
    },
  },
  replyPerformance: { replyRate: 0, avgReplyHours: null },
  recentReviews: [
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000009'),
      rating: 5,
      snippet: 'Great stay, easy parking.',
      reviewedAt: new Date('2026-07-01T10:00:00Z'),
      replyStatus: 'none',
    },
    {
      id: reviewId('rev-00000000-0000-0000-0000-000000000010'),
      rating: 5,
      snippet: 'Friendly team.',
      // Unparsable on purpose: a provider timestamp that never arrived used to
      // take the whole page down with a RangeError.
      reviewedAt: new Date('not-a-date'),
      replyStatus: 'none',
    },
  ],
}

const meta: Meta<typeof PropertyOverview> = {
  title: 'Property/PropertyOverview',
  component: PropertyOverview,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  args: {
    property,
    propertyId: property.id,
    lifetime: populatedDashboard,
    pulse: populatedDashboard,
    signals: activeSignals,
    guestVoiceFns: aiReady,
    profileViewsFns: googleReady,
  },
}
export default meta
type Story = StoryObj<typeof PropertyOverview>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

    // Four rows, in order, each a real heading rather than an uppercase eyebrow.
    for (const heading of [
      'Needs attention',
      'How you are doing',
      'Guest voice',
      'Latest reviews',
    ]) {
      expect(canvas.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
    }

    // No range control: Overview is a reading, not a report you configure.
    expect(canvas.queryByRole('group', { name: 'Time range' })).toBeNull()

    // Identity beside pulse. The rating leads all-time; reviews lead recent.
    expect(canvas.getByText('4.3 ★')).toBeVisible()
    expect(canvas.getByText(/4\.3 over the last 30 days/)).toBeVisible()
    expect(await canvas.findByText('1,190')).toBeVisible()

    // Every tile is the door to the page that explains it.
    expect(canvas.getByRole('link', { name: 'Rating — open Ratings' })).toBeVisible()
    expect(
      await canvas.findByRole('link', {
        name: 'Profile views — open Google Business Profile',
      }),
    ).toBeVisible()

    expect(await canvas.findByText('Staff praised more often this month')).toBeVisible()

    // No charts, and nothing that was moved to a topic page.
    expect(canvas.queryByRole('img', { name: /rating/i })).toBeNull()
    expect(canvas.queryByText(/reputation over time/i)).toBeNull()
    expect(canvas.queryByText(/engagement funnel/i)).toBeNull()

    // Availability by exception: a ready metric says nothing about its pedigree.
    expect(canvas.queryByText(/Data through/)).toBeNull()
    expect(canvas.queryByText(/^Ready$/)).toBeNull()
  },
}

export const WeekOne: Story = {
  args: {
    lifetime: weekOne,
    pulse: weekOne,
    signals: calmSignals,
    guestVoiceFns: aiOff,
    profileViewsFns: googleUnavailable,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The rule: a number where there is one, otherwise a sentence and an action.
    expect(canvas.queryByText('—')).toBeNull()

    expect(canvas.getByText('5.0 ★')).toBeVisible()
    expect(canvas.getByText(/2 new ratings in the last 30 days/)).toBeVisible()
    expect(canvas.getByText('2')).toBeVisible()
    // Two reviews arrived and neither has a reply: 0% is a true figure, not a
    // dash, and the line says what is missing rather than printing `—`.
    expect(canvas.getByText('0%')).toBeVisible()
    expect(canvas.getByText(/nothing replied to yet/)).toBeVisible()

    // A calm property says so rather than dropping the row.
    expect(canvas.getByText('Nothing needs your attention.')).toBeVisible()

    // Both absent figures explain themselves and offer the action.
    expect(
      await canvas.findByText(/Turn on AI analysis to see what guests praise/),
    ).toBeVisible()
    expect(await canvas.findByRole('link', { name: 'Turn on AI analysis' })).toBeVisible()
    expect(await canvas.findByRole('link', { name: 'Connect Google' })).toBeVisible()

    // The unparsable review date loses its timestamp, not the page.
    expect(canvas.getByText('Friendly team.')).toBeVisible()
    expect(canvasElement.textContent).not.toMatch(/Invalid Date|NaN/)
  },
}

export const FillingIn: Story = {
  args: { guestVoiceFns: aiPreparing },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/Analysing your reviews\. Topics appear as soon as/),
    ).toBeVisible()
    // The rest of the page is unaffected by an analysis that has not settled.
    expect(canvas.getByText('4.3 ★')).toBeVisible()
  },
}

export const GoogleUnavailable: Story = {
  args: { profileViewsFns: googleUnavailable },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('link', { name: 'Connect Google' })).toBeVisible()
    // One tile degrading never takes the scorecard with it.
    expect(canvas.getByText('4.3 ★')).toBeVisible()
    expect(canvas.getByText('78%')).toBeVisible()
  },
}

export const NoProperty: Story = {
  args: { property: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Overview')).toBeNull()
  },
}

/**
 * Row 13: Overview is a phone screen. Two screens of a 390 × 844 viewport is
 * 1,688 px; the page it replaces was 5,837 px.
 */
export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('1,190')).toBeVisible()
    const height = canvasElement.ownerDocument.documentElement.scrollHeight
    expect(height).toBeLessThanOrEqual(844 * 2)
  },
}
