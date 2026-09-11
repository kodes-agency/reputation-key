import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent } from 'storybook/test'
import { PropertyReputationTrendChart } from './property-reputation-trend-chart'

const meta = {
  title: 'Property/PropertyReputationTrendChart',
  component: PropertyReputationTrendChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    range: '30d',
    ratingTrend: [
      { date: '2026-07-01', avgRating: 1 },
      { date: '2026-07-02', avgRating: 5 },
      { date: '2026-07-03', avgRating: 5 },
    ],
    reviewVolume: [
      { date: '2026-07-01', count: 1 },
      { date: '2026-07-02', count: 1 },
      { date: '2026-07-03', count: 2 },
    ],
  },
} satisfies Meta<typeof PropertyReputationTrendChart>

export default meta
type Story = StoryObj<typeof meta>

export const RunningAverage: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Rating over time' })).toBeVisible()
    await expect(canvas.getByText('1.0 → 4.0 over 30 days · 4 new reviews')).toBeVisible()
    const chart = canvas.getByTestId('reputation-trend-chart')
    expect(chart).toHaveAttribute('data-series', 'review-volume,average-rating')
    expect(chart).toHaveAttribute('data-point-count', '3')

    await userEvent.click(canvas.getByText('View chart values'))
    await expect(canvas.getByText('3.0 ★')).toBeVisible()
    await expect(canvas.getByText('4.0 ★')).toBeVisible()
  },
}

export const TooThin: Story = {
  args: {
    ratingTrend: [
      { date: '2026-07-01', avgRating: 1 },
      { date: '2026-07-02', avgRating: 5 },
    ],
    reviewVolume: [
      { date: '2026-07-01', count: 1 },
      { date: '2026-07-02', count: 1 },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('reputation-trend-too-thin')).toHaveTextContent(
      '1.0 → 3.0 over 30 days · 2 new reviews',
    )
    expect(canvas.queryByRole('img')).toBeNull()
  },
}

export const Empty: Story = {
  args: { ratingTrend: [], reviewVolume: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('reputation-trend-empty')).toBeVisible()
    expect(canvas.queryByRole('img')).toBeNull()
  },
}
