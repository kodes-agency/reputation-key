// Property Overview — the attention band, the KPI strip, the two AI sections
// and recent reviews. Pure data-display surface: all data arrives via props
// (DashboardData + AttentionSignals), no server/RPC.
//
// Rating trend, rating mix and reply performance moved to the Ratings page and
// the Google report to the Google page (redesign rows 1, 7a, 7b); their stories
// moved with them.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PropertyDashboard } from './property-dashboard'
import { TIME_RANGE_OPTIONS } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { TimeRangePreset } from '#/contexts/reporting/application/dto/dashboard.dto'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import {
  activeSignals,
  calmSignals,
  noDataDashboard,
  populatedDashboard,
  property,
} from './property-dashboard-stories-data'

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
    expect(await canvas.findByText('Review signals improved')).toBeVisible()
    // The basis-point field is a change magnitude, never a confidence score.
    expect(await canvas.findByText(/largest change 25 pts/i)).toBeVisible()
    expect(canvas.queryByText(/confidence/i)).toBeNull()

    // Rating mix, rating trend and reply performance live on the Ratings page
    // now; the Google report on its own page.
    expect(canvas.queryByRole('img', { name: /rating/i })).toBeNull()
    expect(canvas.queryByText(/reputation over time/i)).toBeNull()
    expect(canvas.queryByText(/reply rate/i)).toBeNull()
    expect(canvas.queryByText(/google business profile/i)).toBeNull()
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

// The selected window is complete but contains no eligible KPI readings.
export const NoDataWindow: Story = {
  args: { ...Default.args, dashboard: noDataDashboard, signals: calmSignals },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = (label: string) => {
      const element = canvas.getByText(label).closest('.rounded-lg')
      if (!(element instanceof HTMLElement)) throw new Error(`${label} card is missing`)
      return within(element)
    }

    expect(canvas.getByText(/no reviews yet/i)).toBeVisible()
    expect(card('Reviews').getByText('Ready')).toBeVisible()
    expect(card('Reviews').queryByText(/Data through/)).toBeNull()
    expect(
      card('Avg Rating').getByText('No eligible ratings in this period.'),
    ).toBeVisible()
    expect(card('Scans').getByText('No scans recorded in this period.')).toBeVisible()
    expect(
      card('Feedback').getByText('No private feedback received in this period.'),
    ).toBeVisible()
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
