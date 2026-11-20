import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { RatingDistributionChart } from './rating-distribution-chart'

const meta = {
  title: 'Shared/RatingDistributionChart',
  component: RatingDistributionChart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    labelledBy: 'rating-distribution-story-title',
    label: 'Rating mix',
    distribution: [
      { stars: 1, count: 4 },
      { stars: 2, count: 6 },
      { stars: 3, count: 12 },
      { stars: 4, count: 40 },
      { stars: 5, count: 80 },
    ],
  },
  render: (args) => (
    <section className="w-full max-w-3xl space-y-3">
      <h2
        id="rating-distribution-story-title"
        className="text-lg font-semibold tracking-tight"
      >
        Rating mix
      </h2>
      <RatingDistributionChart {...args} />
    </section>
  ),
} satisfies Meta<typeof RatingDistributionChart>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('figure', { name: 'Rating mix' })).toBeVisible()
    for (const label of ['5★', '4★', '3★', '2★', '1★']) {
      await expect(canvas.getByText(label)).toBeVisible()
    }
    await expect(canvas.getByText('80 · 56.3%')).toBeVisible()
    await expect(canvas.getByText('4 · 2.8%')).toBeVisible()
  },
}

export const Empty: Story = {
  args: { distribution: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No ratings in this period.')).toBeVisible()
    expect(canvas.queryByRole('figure')).toBeNull()
  },
}

export const Compact390: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('80 · 56.3%')).toBeVisible()
  },
}
