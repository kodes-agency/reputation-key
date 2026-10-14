// How far a count has got toward a whole: a neutral bar by default, with the
// value, range and a sentence for a screen reader. The tones are for a bar that
// carries a verdict (the Google rating goal card will use them). Dark is the
// default theme; the Light variants draw the same bars on the light surface, and
// axe checks the contrast of both.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ProgressBar } from './progress-bar'

const meta: Meta<typeof ProgressBar> = {
  title: 'Patterns/Progress bar',
  component: ProgressBar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: 64, max: 120, label: 'Qualified scans so far this month' },
  decorators: [
    (Story) => (
      <div className="max-w-64">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ProgressBar>

/** A count part-way to its whole: neutral, with its range and a sentence. */
export const Neutral: Story = {
  args: { valueText: '64 of 120 so far' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', {
      name: 'Qualified scans so far this month',
    })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '120')
    expect(bar).toHaveAttribute('aria-valuenow', '64')
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 120 so far')
    expect(bar).toHaveAttribute('data-tone', 'neutral')
  },
}

/** Nothing counted yet is an empty bar and a zero, not a missing one. */
export const Empty: Story = {
  args: { value: 0, valueText: '0 of 120 so far' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.firstElementChild).toHaveAttribute('style', 'transform: scaleX(0);')
  },
}

/** A count past its whole fills the bar and no more; the sentence keeps the truth. */
export const PastTheWhole: Story = {
  args: { value: 150, valueText: '150 of 120 so far' },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '120')
    expect(bar).toHaveAttribute('aria-valuetext', '150 of 120 so far')
    expect(bar.firstElementChild).toHaveAttribute('style', 'transform: scaleX(1);')
  },
}

/** The fill is a transform, so it moves without laying anything out. */
export const MovesWithATransform: Story = {
  args: { value: 60, max: 120 },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar')
    // The fill is sized by its transform alone: no width, no layout property.
    expect(bar.firstElementChild).toHaveAttribute('style', 'transform: scaleX(0.5);')
  },
}

/** A bar that carries a verdict wears the tone's solid ink on the same quiet track. */
export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {(['neutral', 'positive', 'warn', 'negative', 'info'] as const).map((tone) => (
        <ProgressBar key={tone} {...args} tone={tone} label={`${tone} bar`} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const bars = within(canvasElement).getAllByRole('progressbar')
    expect(bars.map((bar) => bar.getAttribute('data-tone'))).toEqual([
      'neutral',
      'positive',
      'warn',
      'negative',
      'info',
    ])
  },
}

export const NeutralLight: Story = { ...Neutral, parameters: { theme: 'light' } }
export const TonesLight: Story = { ...Tones, parameters: { theme: 'light' } }
