import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type {
  AiPropertyInsightsRead,
  PropertyInsightsRange,
} from '#/contexts/ai/application/public-api'
import { PropertyInsightsReport } from './property-insights-report'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

const populated: Extract<AiPropertyInsightsRead, { status: 'ready' }> = {
  status: 'ready',
  range: 90,
  startLocalDate: '2026-06-13',
  endLocalDate: '2026-09-10',
  precedingPeriod: {
    startLocalDate: '2026-03-15',
    endLocalDate: '2026-06-12',
  },
  dataThroughLocalDate: '2026-09-10',
  impactVersion: 'aspect-impact-v1',
  basis: {
    reviewCount: 120,
    analyzedReviewCount: 96,
    currentAnalysisCount: 102,
    starOnlyCount: 18,
    notAnalyzableCount: 6,
    awaitingAnalysisCount: 0,
    ratingDistribution: [
      { stars: 1, count: 8 },
      { stars: 2, count: 12 },
      { stars: 3, count: 22 },
      { stars: 4, count: 36 },
      { stars: 5, count: 42 },
    ],
  },
  aspects: [
    {
      aspect: 'service',
      polarity: 'negative',
      mentionCount: 28,
      impact: -18.4,
      comparison: {
        precedingMentionCount: 19,
        precedingImpact: -11.2,
        mentionCountDelta: 9,
        impactDelta: -7.2,
      },
    },
    {
      aspect: 'cleanliness',
      polarity: 'positive',
      mentionCount: 24,
      impact: 16.7,
      comparison: {
        precedingMentionCount: 20,
        precedingImpact: 13.1,
        mentionCountDelta: 4,
        impactDelta: 3.6,
      },
    },
    {
      aspect: 'room',
      polarity: 'negative',
      mentionCount: 17,
      impact: -10.3,
      comparison: {
        precedingMentionCount: 21,
        precedingImpact: -13.6,
        mentionCountDelta: -4,
        impactDelta: 3.3,
      },
    },
    {
      aspect: 'staff',
      polarity: 'positive',
      mentionCount: 16,
      impact: 9.8,
      comparison: {
        precedingMentionCount: 12,
        precedingImpact: 7.4,
        mentionCountDelta: 4,
        impactDelta: 2.4,
      },
    },
  ],
  weeklyAspectSeries: [
    {
      aspect: 'service',
      points: [
        { weekStartLocalDate: '2026-06-13', mentionCount: 3 },
        { weekStartLocalDate: '2026-06-20', mentionCount: 5 },
        { weekStartLocalDate: '2026-06-27', mentionCount: 4 },
        { weekStartLocalDate: '2026-07-04', mentionCount: 7 },
        { weekStartLocalDate: '2026-07-11', mentionCount: 4 },
        { weekStartLocalDate: '2026-07-18', mentionCount: 5 },
      ],
    },
    {
      aspect: 'cleanliness',
      points: [
        { weekStartLocalDate: '2026-06-13', mentionCount: 2 },
        { weekStartLocalDate: '2026-06-20', mentionCount: 4 },
        { weekStartLocalDate: '2026-06-27', mentionCount: 3 },
        { weekStartLocalDate: '2026-07-04', mentionCount: 5 },
        { weekStartLocalDate: '2026-07-11', mentionCount: 6 },
        { weekStartLocalDate: '2026-07-18', mentionCount: 4 },
      ],
    },
    {
      aspect: 'room',
      points: [
        { weekStartLocalDate: '2026-06-13', mentionCount: 4 },
        { weekStartLocalDate: '2026-06-20', mentionCount: 3 },
        { weekStartLocalDate: '2026-06-27', mentionCount: 2 },
        { weekStartLocalDate: '2026-07-04', mentionCount: 3 },
        { weekStartLocalDate: '2026-07-11', mentionCount: 2 },
        { weekStartLocalDate: '2026-07-18', mentionCount: 3 },
      ],
    },
  ],
  emergingIssues: [
    {
      label: 'front desk delays',
      count: 12,
      comparison: { precedingCount: 5, delta: 7 },
    },
    {
      label: 'bathroom maintenance',
      count: 7,
      comparison: { precedingCount: 9, delta: -2 },
    },
    {
      label: 'air conditioning noise',
      count: 4,
      comparison: { precedingCount: 4, delta: 0 },
    },
  ],
}

const allTime: Extract<AiPropertyInsightsRead, { status: 'ready' }> = {
  ...populated,
  range: 'all',
  startLocalDate: '2025-06-25',
  precedingPeriod: null,
  aspects: populated.aspects.map((aspect) => ({ ...aspect, comparison: null })),
  emergingIssues: populated.emergingIssues.map((issue) => ({
    ...issue,
    comparison: null,
  })),
}

function StoryReport({ result }: Readonly<{ result: AiPropertyInsightsRead }>) {
  const [range, setRange] = useState<PropertyInsightsRange>(
    result.status === 'ready' ? result.range : 90,
  )
  return (
    <PropertyInsightsReport
      propertyId={PROPERTY_ID}
      propertyName="Harbour House Hotel"
      range={range}
      onRangeChange={setRange}
      result={result}
    />
  )
}

function ReportHarness({ result }: Readonly<{ result: AiPropertyInsightsRead }>) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet })
    const reportRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <StoryReport result={result} />,
    })
    const inboxRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inbox',
      component: () => <p>Inbox link target</p>,
    })
    return createRouter({
      routeTree: rootRoute.addChildren([reportRoute, inboxRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  })
  return <RouterProvider router={router} />
}

const meta: Meta<typeof PropertyInsightsReport> = {
  title: 'Property/PropertyInsightsReport',
  component: PropertyInsightsReport,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof PropertyInsightsReport>

async function selectedAllTimeCanvas(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  expect(await canvas.findByRole('button', { name: 'All Time' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  return canvas
}

export const PopulatedReport: Story = {
  render: () => <ReportHarness result={populated} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Harbour House Hotel insights')).toBeVisible()
    expect(await canvas.findByText(/Based on 120 reviews/)).toBeVisible()
    expect(
      await canvas.findByText(/6 not analysable in a supported language/),
    ).toBeVisible()
    expect(await canvas.findByRole('heading', { name: 'Aspect impact' })).toBeVisible()
    expect(await canvas.findByText('front desk delays')).toBeVisible()
    const service = await canvas.findByRole('link', { name: /Service.*Complaints/ })
    expect(service.getAttribute('href')).toContain('aspect=service')
    expect(service.getAttribute('href')).toContain('polarity=negative')
  },
}

export const AllTimeHistorical: Story = {
  render: () => <ReportHarness result={allTime} />,
  play: async ({ canvasElement }) => {
    const canvas = await selectedAllTimeCanvas(canvasElement)
    expect(await canvas.findByText(/window starts 25 Jun 2025/)).toBeVisible()
    expect(
      await canvas.findAllByText(/Comparison is unavailable for All Time/),
    ).toHaveLength(2)
    expect(canvas.queryByText('Change vs previous')).toBeNull()
    expect(canvas.queryByText(/\+7 vs previous/)).toBeNull()
  },
}

export const Preparing: Story = {
  render: () => <ReportHarness result={{ status: 'preparing' }} />,
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByText(
        'Analysis for this property is still settling',
      ),
    ).toBeVisible()
  },
}

export const InsufficientData: Story = {
  render: () => (
    <ReportHarness
      result={{
        status: 'insufficient_data',
        startLocalDate: '2026-06-13',
        endLocalDate: '2026-09-10',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText('Not enough review evidence in this period'),
    ).toBeVisible()
    expect(canvas.queryByText('0 reviews')).toBeNull()
  },
}

export const DisabledCapability: Story = {
  render: () => <ReportHarness result={{ status: 'disabled' }} />,
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByText(
        'Insights are not available for this property',
      ),
    ).toBeVisible()
  },
}

export const ZeroEmergingIssues: Story = {
  render: () => <ReportHarness result={{ ...populated, emergingIssues: [] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(
        'No recurring issue labels were found among the analysed reviews in this period.',
      ),
    ).toBeVisible()
    expect(await canvas.findByText('Service')).toBeVisible()
  },
}

export const AllTimeAnalyzedWithoutMentions: Story = {
  render: () => (
    <ReportHarness
      result={{
        ...allTime,
        basis: {
          reviewCount: 12,
          analyzedReviewCount: 12,
          currentAnalysisCount: 12,
          starOnlyCount: 0,
          notAnalyzableCount: 0,
          awaitingAnalysisCount: 0,
          ratingDistribution: [
            { stars: 1, count: 0 },
            { stars: 2, count: 1 },
            { stars: 3, count: 2 },
            { stars: 4, count: 4 },
            { stars: 5, count: 5 },
          ],
        },
        aspects: [],
        weeklyAspectSeries: [],
        emergingIssues: [],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = await selectedAllTimeCanvas(canvasElement)
    // Each empty section has its own observable contract; combining these assertions
    // would allow one report section to disappear without naming the regression.
    // fallow-ignore-next-line code-duplication
    expect(await canvas.findByText(/No aspect mentions were identified/)).toBeVisible()
    expect(await canvas.findByText(/No weekly aspect trend can be plotted/)).toBeVisible()
    expect(await canvas.findByText(/No recurring issue labels were found/)).toBeVisible()
    expect(canvas.queryByText('Change vs previous')).toBeNull()
  },
}

export const AllReviewsAreStarOnly: Story = {
  render: () => (
    <ReportHarness
      result={{
        ...populated,
        basis: {
          reviewCount: 12,
          analyzedReviewCount: 0,
          currentAnalysisCount: 0,
          starOnlyCount: 12,
          notAnalyzableCount: 0,
          awaitingAnalysisCount: 0,
          ratingDistribution: [
            { stars: 1, count: 1 },
            { stars: 2, count: 1 },
            { stars: 3, count: 2 },
            { stars: 4, count: 3 },
            { stars: 5, count: 5 },
          ],
        },
        aspects: [],
        weeklyAspectSeries: [],
        emergingIssues: [],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/12 star-only/)).toBeVisible()
    expect(
      await canvas.findByText(
        'Star-only reviews are included here and excluded from aspect counts.',
      ),
    ).toBeVisible()
    // Each unavailable section is independently asserted because omitting any one
    // would let an unsupported zero-evidence presentation regress unnoticed.
    // fallow-ignore-next-line code-duplication
    expect(
      await canvas.findByText(/aspect mentions and impact cannot be reported/),
    ).toBeVisible()
    expect(
      await canvas.findByText(/weekly aspect trends cannot be reported/),
    ).toBeVisible()
    expect(await canvas.findByText(/emerging issues cannot be assessed/)).toBeVisible()
  },
}
