// What guests talk about — the AI category breakdown and sentiment mix.
//
// The section is self-fetching, so each story stubs the server function with a
// different status. Every status the read can return gets a story, including the
// two that render nothing, because "renders nothing" is the behaviour a
// capability-gated section is most likely to get wrong.
//
// The category rows are router Links into the inbox, so the stories mount a
// two-route memory router — the same harness shape as fleet-overview.stories.
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
  startLocalDate: '2026-07-22',
  endLocalDate: '2026-08-20',
  reviewCount: 48,
  categories: [
    { category: 'service', count: 18 },
    { category: 'cleanliness', count: 11 },
    { category: 'wait_time', count: 9 },
    { category: 'value', count: 6 },
    { category: 'staff', count: 4 },
    { category: 'quality', count: 0 },
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

export const Ready: Story = {
  render: () => <SectionHarness getAggregates={stub(readyData)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('What guests talk about')).toBeVisible()
    // Sorted by volume, so service leads.
    expect(await canvas.findByText('Service')).toBeVisible()
    expect(await canvas.findByText('18')).toBeVisible()
    // wait_time must read as words, not as its identifier.
    expect(await canvas.findByText('Wait time')).toBeVisible()
    expect(canvas.queryByText('wait_time')).toBeNull()
    // A zero-count category is not something guests talked about.
    expect(canvas.queryByText('Quality')).toBeNull()
    // The window is stated, because it is property-local and fixed.
    expect(await canvas.findByText(/2026-07-22 to 2026-08-20/)).toBeVisible()
  },
}

export const RowsDeepLinkIntoTheInbox: Story = {
  render: () => <SectionHarness getAggregates={stub(readyData)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = await canvas.findByRole('link', { name: /Service/ })
    // The whole point of the breakdown: the answer to "what should I fix?" has
    // to be actionable. A row linking to an unfiltered inbox would be the exact
    // defect this section replaces.
    const href = row.getAttribute('href') ?? ''
    expect(href).toContain('category=service')
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

// An enabled property with no analysed reviews yet: the section appears and says
// so, rather than drawing an empty chart.
export const ReadyButEmpty: Story = {
  render: () => (
    <SectionHarness
      getAggregates={stub({
        status: 'ready',
        startLocalDate: '2026-08-14',
        endLocalDate: '2026-08-20',
        reviewCount: 0,
        categories: [],
        sentimentByDay: [],
        sentimentTotals: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No categorised reviews/)).toBeVisible()
    expect(await canvas.findByText(/No analysed reviews/)).toBeVisible()
  },
}
