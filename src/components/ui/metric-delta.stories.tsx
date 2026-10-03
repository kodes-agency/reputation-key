// A period-over-period change, drawn once: an arrow, the size, the baseline and
// the direction in words. The ink is the text-grade positive / negative pair, so
// a fall reads as a fall on every page (it used to be destructive on Ratings and
// negative on Overview). Dark is the default theme; the light variant renders the
// same lines on the light surface, and axe checks the contrast of both.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { MetricDelta } from './metric-delta'

const meta: Meta<typeof MetricDelta> = {
  title: 'Patterns/Metric delta',
  component: MetricDelta,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 12.5, unit: 'percent', comparisonLabel: 'vs the previous 90 days' },
}

export default meta
type Story = StoryObj<typeof MetricDelta>

/** A rise: the up arrow, the positive ink, "Up" for a screen reader. */
export const Up: Story = {
  play: async ({ canvasElement }) => {
    const delta = canvasElement.querySelector('[data-slot="metric-delta"]')
    expect(delta).toHaveAttribute('data-direction', 'up')
    expect(delta).toHaveTextContent('Up 12.5% vs the previous 90 days')
    expect(delta?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(delta).toHaveClass('text-positive')
  },
}

/** A fall: the down arrow and the negative ink, never the fill-grade red. */
export const Down: Story = {
  args: { value: -3.14, unit: 'points', comparisonLabel: 'vs the previous 30 days' },
  play: async ({ canvasElement }) => {
    const delta = canvasElement.querySelector('[data-slot="metric-delta"]')
    expect(delta).toHaveAttribute('data-direction', 'down')
    expect(delta).toHaveTextContent('Down 3.1 vs the previous 30 days')
    expect(delta).toHaveClass('text-negative')
  },
}

/** No movement says so in plain words: no arrow, no colour. */
export const NoChange: Story = {
  args: { value: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No change vs the previous 90 days')).toBeVisible()
    expect(canvasElement.querySelector('svg')).toBeNull()
  },
}

/** A move too small for the digits shown is no change, not "up 0". */
export const TooSmallToShow: Story = {
  args: { value: 0.04, unit: 'points' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/^No change/)).toBeVisible()
  },
}

/** A tile that shows whole points keeps no decimals. */
export const WholePoints: Story = {
  args: { value: 11.6, fractionDigits: 0, comparisonLabel: 'vs the previous 30 days' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-slot="metric-delta"]')).toHaveTextContent(
      'Up 12% vs the previous 30 days',
    )
  },
}

/** Inside a sentence, as the Overview tiles use it. */
export const InASentence: Story = {
  render: (args) => (
    <p className="text-sm text-muted-foreground">
      4.3 over the last 30 days · <MetricDelta {...args} />
    </p>
  ),
  args: { value: 0.2, unit: 'points', comparisonLabel: 'vs the previous 30 days' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('p')).toHaveTextContent(
      '4.3 over the last 30 days · Up 0.2 vs the previous 30 days',
    )
  },
}

export const UpLight: Story = { ...Up, parameters: { theme: 'light' } }
export const DownLight: Story = { ...Down, parameters: { theme: 'light' } }
