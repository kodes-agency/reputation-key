// Dashboard → Ratings. The rating-trend and rating-mix stories moved here with
// the sections they cover (redesign rows 1, 7a); the fixtures are the overview's
// own, unchanged, so a regression in the merge logic still fails here.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { PropertyRatingsPage } from './property-ratings-page'
import { populatedDashboard, property } from './property-dashboard-stories-data'

const meta: Meta<typeof PropertyRatingsPage> = {
  title: 'Property/PropertyRatingsPage',
  component: PropertyRatingsPage,
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
type Story = StoryObj<typeof PropertyRatingsPage>

export const Default: Story = {
  args: {
    property,
    dashboard: populatedDashboard,
    range: '90d',
    onRangeChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Ratings', level: 1 })).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Rating over time' })).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Rating mix' })).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Responding' })).toBeVisible()
    expect(canvas.getByRole('img', { name: /rating mix/i })).toBeVisible()
    expect(canvas.getByText('78%')).toBeVisible()
    // One window for the page, spelled the way a manager reads it.
    const range = canvas.getByRole('group', { name: 'Time range' })
    expect(within(range).getByRole('button', { name: '6 months' })).toBeVisible()
    expect(within(range).queryByRole('button', { name: '7 Days' })).toBeNull()
  },
}

// `ratingTrend` and `reviewVolume` were computed, shipped to the browser, and
// never drawn. These pin that they render, and that the shapes which break
// charts are handled rather than crashing or drawing an empty axis.
export const ReputationTrend: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
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

export const NoProperty: Story = {
  args: { ...Default.args, property: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText('Ratings')).toBeNull()
  },
}

export const Compact390: Story = {
  args: { ...Default.args },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}
