// Property dashboard — a property's KPI strip, rating distribution, reply
// performance, engagement funnel and recent reviews. Pure data-display surface:
// all data arrives via props (DashboardData + AttentionSignals), no server/RPC.
// The rating distribution is CSS bars (property-dashboard-helpers); the
// reputation-over-time chart is recharts via the shadcn ChartContainer, so the
// trend stories wait for the series to mount before asserting.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PropertyDashboard } from './property-dashboard'
import { TIME_RANGE_OPTIONS } from '#/contexts/dashboard/application/dto/dashboard.dto'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import type {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import {
  activeSignals,
  calmSignals,
  emptyDashboard,
  populatedDashboard,
  property,
} from './property-dashboard-stories-data'

const performanceFns = {
  getPerformance: (async () => ({
    status: 'unavailable',
    reason: 'integration_unavailable',
    action: null,
  })) as unknown as typeof getPropertyGooglePerformance,
  renewLease: (async () => ({
    ok: false,
  })) as unknown as typeof renewPropertyGooglePerformanceLease,
}
const getAiTrend = (async () => ({
  status: 'ready',
  sourceEpoch: 1,
  reviewAnalysisEpoch: 1,
  propertyTrendsEpoch: 1,
  propertyProfileVersion: 1,
  dueLocalDate: '2026-08-15',
  terminalAnalysisSequence: 24,
  aggregateRevision: 24,
  reportProfileVersion: 'property-trend-v1',
  report: {
    signalKey: 'sentiment.positive.up',
    direction: 'improving',
    changeMagnitudeBasisPoints: 2_500,
    supportingReviewCount: 24,
    headline: 'Review signals improved',
    sentences: ['Positive service mentions increased in the current period.'],
  },
  evidence: {
    definitionVersion: 'property-trend-definition-v1',
    definitionDigest: 'a'.repeat(64),
    renderProfileVersion: 'trend-render-v1',
    renderProfileDigest: 'b'.repeat(64),
    timezone: 'Europe/Sofia',
    dataThroughLocalDate: '2026-08-14',
    baseline: {
      period: { startLocalDate: '2026-06-16', endLocalDate: '2026-07-15' },
      textCandidateCount: 24,
      analyzedCount: 24,
      excludedCount: 0,
      starOnlyCount: 4,
      coverageBasisPoints: 10_000,
    },
    current: {
      period: { startLocalDate: '2026-07-16', endLocalDate: '2026-08-14' },
      textCandidateCount: 24,
      analyzedCount: 24,
      excludedCount: 0,
      starOnlyCount: 3,
      coverageBasisPoints: 10_000,
    },
    modelLineage: [],
    selectedSignals: [
      {
        signalId: 'sentiment.positive.up',
        baseline: { count: 0, total: 24 },
        current: { count: 6, total: 24 },
        changeMagnitudeBasisPoints: 2_500,
      },
    ],
    supportingReviews: [],
  },
  updating: false,
  generatedAtEpochMillis: Date.UTC(2026, 7, 15, 12),
})) as unknown as typeof getPropertyAiTrendFn
const getAiAggregates = (async () => ({
  status: 'disabled',
})) as unknown as typeof getPropertyAiAggregatesFn

const meta: Meta<typeof PropertyDashboard> = {
  title: 'Property/PropertyDashboard',
  component: PropertyDashboard,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof PropertyDashboard>

export const Default: Story = {
  args: {
    property,
    dashboard: populatedDashboard,
    signals: activeSignals,
    propertyId: property.id,
    timeRange: '30d',
    onTimeRangeChange: (_value: TimeRangePreset) => {},
    performanceRange: '30d',
    onPerformanceRangeChange: () => {},
    performanceFns,
    getAiTrend,
    getAiAggregates,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The property name renders in both the breadcrumb (current page) and the
    // header description, so it appears more than once — assert the first.
    expect(canvas.getAllByText('Harborline Suites')[0]).toBeVisible()
    // Time range is a segmented toggle group (role="group"); each option is a
    // button labelled with its preset, scoped to that group.
    const timeRangeGroup = canvas.getByRole('group', { name: /time range/i })
    for (const opt of TIME_RANGE_OPTIONS) {
      expect(
        within(timeRangeGroup).getByRole('button', { name: opt.label }),
      ).toBeVisible()
    }
    expect(canvas.getByText('+0.2 stars')).toBeVisible()
    expect(canvas.getByText('Overdue')).toBeVisible()
    expect(canvas.getByText(/items to triage/i)).toBeVisible()
    expect(canvas.getByText('5★')).toBeVisible()
    expect(canvas.getByText('78%')).toBeVisible()
    expect(await canvas.findByText('Review signals improved')).toBeVisible()
    // The basis-point field is a change magnitude, never a confidence score.
    expect(await canvas.findByText(/largest change 25 pts/i)).toBeVisible()
    expect(canvas.queryByText(/confidence/i)).toBeNull()
  },
}

// Calm dashboard — no attention signals, so the attention band is hidden entirely.
export const AllClear: Story = {
  args: { ...Default.args, signals: calmSignals },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Overdue')).toBeNull()
    expect(canvas.queryByText(/items to triage/i)).toBeNull()
  },
}

// Rating-drop flag flips the attention band to destructive tone.
export const RatingDrop: Story = {
  args: { ...Default.args, signals: { ...activeSignals, ratingDrop: true } },
}

// A brand-new property: zeroed KPIs, empty arrays, null funnel, no reviews.
export const EmptyDashboard: Story = {
  args: { ...Default.args, dashboard: emptyDashboard, signals: calmSignals },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no reviews yet/i)).toBeVisible()
    const ratingCard = canvas.getByText('Avg Rating').closest('.rounded-lg')
    expect(ratingCard).not.toBeNull()
    expect(within(ratingCard as HTMLElement).getAllByText('—')).toHaveLength(2)
    expect(within(ratingCard as HTMLElement).getByText('Insufficient data')).toBeVisible()
    expect(within(ratingCard as HTMLElement).queryByText('0.0')).toBeNull()
  },
}

// `ratingTrend` and `reviewVolume` were computed, shipped to the browser, and
// never drawn. These pin that they render, and that the shapes which break
// charts are handled rather than crashing or drawing an empty axis.
export const ReputationTrend: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/reputation over time/i)).toBeVisible()
    expect(canvas.queryByTestId('reputation-trend-empty')).toBeNull()
    const chart = canvas.getByTestId('reputation-trend-chart')
    expect(chart).toHaveAttribute('data-series', 'review-volume,average-rating')
    expect(chart).toHaveAttribute('data-point-count', '3')
  },
}

export const ReputationTrendEmpty: Story = {
  args: {
    ...Default.args,
    dashboard: { ...populatedDashboard, ratingTrend: [], reviewVolume: [] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // An axis with no series is worse than saying there is nothing yet.
    expect(canvas.getByTestId('reputation-trend-empty')).toBeVisible()
  },
}

export const ReputationTrendSparse: Story = {
  args: {
    ...Default.args,
    dashboard: {
      ...populatedDashboard,
      // Deliberately misaligned: a volume day with no rating, and a rating day
      // with no volume. Zipping these by index would drop or mispair points.
      ratingTrend: [{ date: '2026-07-02', avgRating: 4.6 }],
      reviewVolume: [{ date: '2026-07-01', count: 3 }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId('reputation-trend-empty')).toBeNull()
    // Two distinct calendar days survive the merge. The pure merge unit test
    // pins their exact values independently of Recharts' private class names.
    expect(canvas.getByTestId('reputation-trend-chart')).toHaveAttribute(
      'data-point-count',
      '2',
    )
  },
}

// Property not yet loaded — component renders nothing.
export const NoProperty: Story = {
  args: { ...Default.args, property: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Harborline Suites')).toBeNull()
  },
}
