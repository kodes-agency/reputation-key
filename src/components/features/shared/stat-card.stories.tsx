import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { StatCard } from './stat-card'

const meta: Meta<typeof StatCard> = {
  title: 'Shared/StatCard',
  component: StatCard,
  args: {
    label: 'Reviews',
    value: '128',
  },
}
export default meta
type Story = StoryObj<typeof StatCard>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Reviews')).toBeVisible()
    await expect(canvas.getByText('128')).toBeVisible()
  },
}

export const WithHint: Story = {
  args: {
    label: 'Average rating',
    value: '4.7',
    hint: '+0.2 stars',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+0.2 stars')).toBeVisible()
  },
}

export const Updating: Story = {
  args: {
    label: 'Scans',
    value: '—',
    availability: {
      state: 'updating',
      dataThrough: null,
      reason: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Updating')).toBeVisible()
    await expect(
      canvas.getByText('Updating; figures will appear when checks finish.'),
    ).toBeVisible()
  },
}
