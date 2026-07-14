// Fleet overview — cross-property KPI landing. The component is a data-display
// surface (org-wide strip of totals + per-property rows that deep-link into the
// detail page). There is no `loading` prop on `FleetOverview`; loading/empty/
// error are rendered by sibling exports the route shell switches between, so
// they are shown here as separate variants via render functions.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import {
  FleetOverview,
  FleetOverviewEmpty,
  FleetOverviewError,
  FleetOverviewLoading,
} from './fleet-overview'
import { entries, populatedData } from './fleet-overview-stories-data'

const meta: Meta<typeof FleetOverview> = {
  title: 'Dashboard/FleetOverview',
  component: FleetOverview,
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
type Story = StoryObj<typeof FleetOverview>

export const Default: Story = {
  args: { data: populatedData },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Properties')).toBeVisible()
    expect(canvas.getByText('Needs action')).toBeVisible()
    expect(canvas.getByText('Avg rating')).toBeVisible()
    expect(canvas.getByText(String(populatedData.totals.propertyCount))).toBeVisible()
    expect(canvas.getByText('Harborline Suites')).toBeVisible()
    expect(canvas.getByText('All clear')).toBeVisible()
    expect(canvas.getByText('17 needing action')).toBeVisible()
  },
}

// Minimum fleet (2 properties — the org tier that triggers the fleet view).
export const MinimumFleet: Story = {
  args: {
    data: {
      entries: entries.slice(0, 2),
      totals: {
        propertyCount: 2,
        totalAttention: 8 + 17,
        overallAvgRating: (4.2 + 3.4) / 2,
      },
    },
  },
}

// Every property healthy — no destructive strip / badges.
export const AllClear: Story = {
  args: {
    data: {
      entries: [entries[2]],
      totals: { propertyCount: 1, totalAttention: 0, overallAvgRating: 4.7 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Needs action')).toBeVisible()
    expect(canvas.getByText('0')).toBeVisible()
    expect(canvas.getByText('All clear')).toBeVisible()
  },
}

// Empty state — org has no properties yet (CTA: Create Property).
export const Empty: Story = {
  render: () => <FleetOverviewEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: /no properties yet/i })).toBeVisible()
    expect(canvas.getByRole('link', { name: /create property/i })).toBeVisible()
  },
}

// Loading state — route shell renders this while fetching.
export const Loading: Story = {
  render: () => <FleetOverviewLoading />,
}

// Error state — retry surfaces the route-invalidate path.
export const Error: Story = {
  parameters: { a11y: { disable: true } },
  render: () => <FleetOverviewError message="We couldn't load your fleet overview." />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/we couldn't load your fleet overview/i)).toBeVisible()
    expect(canvas.getByRole('button', { name: /try again/i })).toBeVisible()
  },
}
