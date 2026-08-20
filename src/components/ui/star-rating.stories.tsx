import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { StarRating } from './star-rating'

const meta: Meta<typeof StarRating> = {
  title: 'UI/StarRating',
  component: StarRating,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof StarRating>

export const Two: Story = {
  args: { value: 2 },
  play: async ({ canvasElement }) => {
    // The rating must never be conveyed by shape or colour alone.
    expect(within(canvasElement).getByText('2 out of 5 stars')).toBeInTheDocument()
  },
}

export const Five: Story = {
  args: { value: 5 },
}

export const CustomLabel: Story = {
  args: { value: 3, label: 'Rated 3 out of 5 stars' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('Rated 3 out of 5 stars')).toBeInTheDocument()
  },
}

/** Out-of-range input is clamped rather than rendering a sixth star. */
export const OutOfRangeIsClamped: Story = {
  args: { value: 9 },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('5 out of 5 stars')).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('svg')).toHaveLength(5)
  },
}

export const LightTheme: Story = {
  args: { value: 4 },
  parameters: { theme: 'light' },
}
