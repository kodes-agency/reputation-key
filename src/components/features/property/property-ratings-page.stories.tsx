// Ratings states at the two dashboard viewports (redesign rows 7a, 9, 12–14).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import type { DashboardData } from '#/contexts/reporting/application/public-api'
import { PropertyRatingsPage } from './property-ratings-page'
import {
  noDataDashboard,
  populatedDashboard,
  property,
} from './property-dashboard-stories-data'

const populated90d: DashboardData = {
  ...populatedDashboard,
  kpis: {
    ...populatedDashboard.kpis,
    reviews: { value: 45, priorValue: 40, trend: 12.5 },
    avgRating: {
      ...populatedDashboard.kpis.avgRating,
      value: 4.3,
      priorValue: 4.1,
      comparison: 0.2,
      sampleCount: 45,
      priorSampleCount: 40,
    },
  },
  ratingDistribution: [
    { stars: 5, count: 25 },
    { stars: 4, count: 12 },
    { stars: 3, count: 4 },
    { stars: 2, count: 2 },
    { stars: 1, count: 2 },
  ],
}

const allTimeDashboard: DashboardData = {
  ...populatedDashboard,
  kpis: {
    ...populatedDashboard.kpis,
    reviews: { value: 142, priorValue: 0, trend: null },
    avgRating: {
      ...populatedDashboard.kpis.avgRating,
      value: 4.3,
      priorValue: null,
      comparison: null,
      sampleCount: 142,
      priorSampleCount: 0,
    },
  },
  ratingTrend: [
    { date: '2026-05-01', avgRating: 4.1 },
    { date: '2026-06-01', avgRating: 4.3 },
    { date: '2026-07-01', avgRating: 4.4 },
  ],
  reviewVolume: [
    { date: '2026-05-01', count: 30 },
    { date: '2026-06-01', count: 45 },
    { date: '2026-07-01', count: 67 },
  ],
}

const tooThinDashboard: DashboardData = {
  ...populatedDashboard,
  kpis: {
    ...populatedDashboard.kpis,
    reviews: { value: 2, priorValue: 1, trend: 100 },
    avgRating: {
      ...populatedDashboard.kpis.avgRating,
      value: 3,
      priorValue: 4,
      comparison: null,
      sampleCount: 2,
      priorSampleCount: 1,
    },
  },
  ratingDistribution: [
    { stars: 5, count: 1 },
    { stars: 1, count: 1 },
  ],
  ratingTrend: [
    { date: '2026-07-01', avgRating: 1 },
    { date: '2026-07-08', avgRating: 5 },
  ],
  reviewVolume: [
    { date: '2026-07-01', count: 1 },
    { date: '2026-07-08', count: 1 },
  ],
  replyPerformance: { replyRate: 50, avgReplyHours: 4 },
}

const meta: Meta<typeof PropertyRatingsPage> = {
  title: 'Property/PropertyRatingsPage',
  component: PropertyRatingsPage,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktopManager' },
  },
  decorators: [AuthedRouterDecorator],
  args: {
    property,
    dashboard: populated90d,
    range: '90d',
    onRangeChange: () => {},
  },
}
export default meta
type Story = StoryObj<typeof PropertyRatingsPage>

export const Populated90d: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Ratings', level: 1 })).toBeVisible()
    for (const heading of ['Rating over time', 'Rating mix', 'Responding']) {
      expect(canvas.getByRole('heading', { name: heading, level: 2 })).toBeVisible()
    }

    const range = canvas.getByRole('group', { name: 'Time range' })
    expect(within(range).getByRole('button', { name: '90 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const summary = within(canvas.getByLabelText('Ratings summary'))
    expect(summary.getByText('4.3 ★')).toBeVisible()
    expect(summary.getByText('↑ 0.2 vs the previous 90 days')).toBeVisible()
    expect(summary.getByText('↑ 12.5% vs the previous 90 days')).toBeVisible()

    const trend = canvas.getByTestId('reputation-trend-chart')
    expect(trend).toHaveAttribute('data-series', 'review-volume,average-rating')
    expect(trend).toHaveAttribute('data-point-count', '5')
    expect(canvas.getByRole('img', { name: 'Rating over time' })).toBeVisible()
    expect(canvas.getByRole('figure', { name: 'Rating mix' })).toBeVisible()
    expect(await canvas.findByText('25 · 55.6%')).toBeVisible()
  },
}

export const AllTime: Story = {
  args: { dashboard: allTimeDashboard, range: 'all' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const range = canvas.getByRole('group', { name: 'Time range' })
    expect(within(range).getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(canvas.queryByText(/vs the previous/i)).toBeNull()
    expect(canvas.queryByText(/ratings in each period to compare/i)).toBeNull()
    expect(canvas.getByTestId('reputation-trend-chart')).toHaveAttribute(
      'data-point-count',
      '3',
    )
  },
}

export const TooThinToChart: Story = {
  args: { dashboard: tooThinDashboard },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId('reputation-trend-chart')).toBeNull()
    expect(canvas.getByTestId('reputation-trend-too-thin')).toHaveTextContent(
      '1.0 → 3.0 over 90 days · 2 new reviews',
    )
    expect(canvas.getByText('Needs 10 ratings in each period to compare.')).toBeVisible()
    expect(canvas.getByRole('figure', { name: 'Rating mix' })).toBeVisible()
  },
}

export const NoRatingsAtAll: Story = {
  args: { dashboard: noDataDashboard },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByTestId('reputation-trend-empty')).toBeVisible()
    expect(canvas.queryByRole('img', { name: /rating/i })).toBeNull()
    expect(canvas.getAllByText('No ratings in this period.')).toHaveLength(2)
    expect(canvasElement.textContent).not.toContain('—')
  },
}

export const NoProperty: Story = {
  args: { property: null },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByText('Ratings')).toBeNull()
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('combobox', { name: 'Time range' })).toBeVisible()
    expect(
      within(canvas.getByLabelText('Ratings summary')).getByText('4.3 ★'),
    ).toBeVisible()
    expect(canvas.getByRole('img', { name: 'Rating over time' })).toBeVisible()
    expect(canvas.getByRole('figure', { name: 'Rating mix' })).toBeVisible()
  },
}
