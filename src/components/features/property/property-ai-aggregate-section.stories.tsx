// What guests talk about — aspect/polarity mentions, impact, issues, and sentiment.
//
// The section is self-fetching, so each story stubs the server function with a
// different status. Aspect rows are router links into the inbox, so the stories
// mount a two-route memory router.
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
import type { getPropertyAiAggregatesFn } from '#/contexts/ai/server/property-aggregates'
import { isAiIssueLabel } from '#/shared/ai-issue-label'
import {
  PropertyAiAggregateSection,
  type PropertyAiAggregatesServerFn,
} from './property-ai-aggregate-section'

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'

// Storybook stubs a server function; there is no runtime shape to validate.
const stub = (value: unknown): PropertyAiAggregatesServerFn =>
  (async () => value) as unknown as typeof getPropertyAiAggregatesFn

const readyData = {
  status: 'ready',
  provisional: false,
  coverage: {
    settledAnalysisCount: 48,
    expectedAnalysisCount: 48,
    awaitingAnalysisCount: 0,
  },
  startLocalDate: '2026-07-22',
  endLocalDate: '2026-08-20',
  reviewCount: 48,
  analyzedReviewCount: 48,
  preAspectAnalysisCount: 0,
  impactVersion: 'aspect-impact-v1',
  aspects: [
    { aspect: 'service', polarity: 'negative', mentionCount: 18, impact: -12.4 },
    { aspect: 'cleanliness', polarity: 'positive', mentionCount: 11, impact: 7.15 },
    { aspect: 'wait_time', polarity: 'negative', mentionCount: 9, impact: -5.6 },
    { aspect: 'room', polarity: 'neutral', mentionCount: 6, impact: 0 },
    { aspect: 'staff', polarity: 'positive', mentionCount: 4, impact: 2.85 },
    { aspect: 'quality', polarity: 'positive', mentionCount: 0, impact: 0 },
  ],
  emergingIssues: [
    { label: 'front desk delays', count: 7 },
    { label: 'bathroom maintenance', count: 4 },
    { label: 'Copied Review Excerpt', count: 99 },
  ],
  sentimentByDay: [
    { localDate: '2026-08-16', positive: 4, neutral: 1, negative: 2, mixed: 0 },
    { localDate: '2026-08-17', positive: 2, neutral: 2, negative: 3, mixed: 1 },
    { localDate: '2026-08-18', positive: 5, neutral: 0, negative: 1, mixed: 0 },
    { localDate: '2026-08-19', positive: 3, neutral: 1, negative: 4, mixed: 2 },
    { localDate: '2026-08-20', positive: 6, neutral: 2, negative: 1, mixed: 1 },
  ],
  sentimentTotals: { positive: 20, neutral: 6, negative: 11, mixed: 4 },
}

const provisionalData = {
  ...readyData,
  provisional: true,
  coverage: {
    settledAnalysisCount: 18,
    expectedAnalysisCount: 20,
    awaitingAnalysisCount: 2,
  },
  reviewCount: 18,
  analyzedReviewCount: 18,
  aspects: readyData.aspects.slice(0, 3),
  emergingIssues: readyData.emergingIssues.slice(0, 2),
  sentimentByDay: readyData.sentimentByDay.slice(-2),
}

function SectionHarness({
  getAggregates,
}: {
  getAggregates: PropertyAiAggregatesServerFn
}) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: Outlet })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <PropertyAiAggregateSection
          propertyId={PROPERTY_ID}
          getAggregates={getAggregates}
        />
      ),
    })
    const inboxRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inbox',
      component: () => <p>inbox (link target)</p>,
    })
    return createRouter({
      routeTree: rootRoute.addChildren([indexRoute, inboxRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  })
  return <RouterProvider router={router} />
}

const meta: Meta<typeof PropertyAiAggregateSection> = {
  title: 'Property/PropertyAiAggregateSection',
  component: PropertyAiAggregateSection,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof PropertyAiAggregateSection>

export const AspectPolarityCountsAndImpact: Story = {
  render: () => <SectionHarness getAggregates={stub(readyData)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('What guests talk about')).toBeVisible()
    expect(await canvas.findByText('Service · Negative')).toBeVisible()
    expect(await canvas.findByText('-12.40')).toBeVisible()
    expect(await canvas.findByText('Wait time · Negative')).toBeVisible()
    expect(canvas.queryByText('wait_time')).toBeNull()
    expect(canvas.queryByText('Quality · Positive')).toBeNull()
    expect(await canvas.findByText('front desk delays')).toBeVisible()
    expect(await canvas.findByText('bathroom maintenance')).toBeVisible()
    const rejectedLabel = 'Copied Review Excerpt'
    expect(isAiIssueLabel(rejectedLabel)).toBe(false)
    expect(canvas.queryByText(rejectedLabel)).toBeNull()
    expect(await canvas.findByText(/2026-07-22 to 2026-08-20/)).toBeVisible()
  },
}

export const ProvisionalPartialAggregates: Story = {
  render: () => <SectionHarness getAggregates={stub(provisionalData)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Provisional figures')).toBeVisible()
    expect(await canvas.findByText(/2 reviews awaiting analysis/)).toBeVisible()
    expect(await canvas.findByText('Service · Negative')).toBeVisible()
    expect(await canvas.findByText(/2 awaiting analysis/)).toBeVisible()
  },
}

export const RowsDeepLinkIntoTheInbox: Story = {
  render: () => <SectionHarness getAggregates={stub(readyData)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = await canvas.findByRole('link', { name: /Service · Negative/ })
    const href = row.getAttribute('href') ?? ''
    expect(href).toContain('aspect=service')
    expect(href).toContain('polarity=negative')
    expect(href).toContain(`propertyId=${PROPERTY_ID}`)
  },
}

export const Preparing: Story = {
  render: () => <SectionHarness getAggregates={stub({ status: 'preparing' })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/still settling/)).toBeVisible()
  },
}

// A tenant without the capability must not be told the feature exists.
export const DisabledRendersNothing: Story = {
  render: () => <SectionHarness getAggregates={stub({ status: 'disabled' })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('What guests talk about')).toBeNull()
  },
}

// An enabled property with no analysed reviews yet: every empty state remains
// explicit rather than drawing an empty chart.
export const ReadyButEmpty: Story = {
  render: () => (
    <SectionHarness
      getAggregates={stub({
        status: 'ready',
        provisional: false,
        coverage: {
          settledAnalysisCount: 1,
          expectedAnalysisCount: 1,
          awaitingAnalysisCount: 0,
        },
        startLocalDate: '2026-08-14',
        endLocalDate: '2026-08-20',
        reviewCount: 0,
        analyzedReviewCount: 0,
        preAspectAnalysisCount: 0,
        impactVersion: 'aspect-impact-v1',
        aspects: [],
        emergingIssues: [],
        sentimentByDay: [],
        sentimentTotals: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No aspect mentions/)).toBeVisible()
    expect(await canvas.findByText(/No emerging issues/)).toBeVisible()
    expect(await canvas.findByText(/No analysed reviews/)).toBeVisible()
  },
}

export const PredatesAspectAnalysis: Story = {
  render: () => (
    <SectionHarness
      getAggregates={stub({
        ...readyData,
        reviewCount: 20,
        analyzedReviewCount: 0,
        preAspectAnalysisCount: 20,
        aspects: [],
        emergingIssues: [],
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/20 analysed before aspect analysis existed/),
    ).toBeVisible()
    expect(
      await canvas.findByText(
        'These reviews were analysed before aspect analysis existed, so aspect mentions and impact cannot be reported.',
      ),
    ).toBeVisible()
  },
}

export const EmergingIssuesEmpty: Story = {
  render: () => (
    <SectionHarness getAggregates={stub({ ...readyData, emergingIssues: [] })} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No emerging issues/)).toBeVisible()
    expect(await canvas.findByText('Service · Negative')).toBeVisible()
  },
}
