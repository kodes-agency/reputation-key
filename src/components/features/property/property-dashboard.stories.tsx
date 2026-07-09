// Property dashboard — a property's KPI strip, rating distribution, reply
// performance, engagement funnel and recent reviews. Pure data-display surface:
// all data arrives via props (DashboardData + AttentionSignals), no server/RPC.
// Charts are CSS bars (property-dashboard-helpers), not recharts, so no sizing hacks.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PropertyDashboard } from './property-dashboard'
import { TIME_RANGE_OPTIONS } from '#/contexts/dashboard/application/dto/dashboard.dto'
import type { TimeRangePreset } from '#/contexts/dashboard/application/dto/dashboard.dto'
import {
  activeSignals,
  calmSignals,
  emptyDashboard,
  populatedDashboard,
  property,
} from './property-dashboard-stories-data'

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
    expect(canvas.getByText(/reviews unanswered/i)).toBeVisible()
    expect(canvas.getByText(/items to triage/i)).toBeVisible()
    expect(canvas.getByText('5★')).toBeVisible()
    expect(canvas.getByText('78%')).toBeVisible()
  },
}

// Calm dashboard — no attention signals, so the attention band is hidden entirely.
export const AllClear: Story = {
  args: { ...Default.args, signals: calmSignals },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText(/reviews unanswered/i)).toBeNull()
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
