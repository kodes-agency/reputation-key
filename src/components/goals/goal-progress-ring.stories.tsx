// GoalProgressRing stories — circular progress + expected notch (based on time elapsed).
// Covers sizes, pace states (ahead/on-pace/behind/at-target), open vs bounded goals.
// Uses realistic Goal shapes for period calc.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { GoalProgressRing } from './goal-progress-ring'

const meta: Meta<typeof GoalProgressRing> = {
  title: 'Goals/GoalProgressRing',
  component: GoalProgressRing,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof GoalProgressRing>

function makePeriod(
  overrides: { periodStart?: Date | null; periodEnd?: Date | null } = {},
) {
  const start = new Date('2026-07-01T00:00:00Z')
  const end = new Date('2026-07-31T23:59:59Z')
  return {
    periodStart: start,
    periodEnd: end,
    ...overrides,
  }
}

export const Default: Story = {
  args: {
    currentValue: 42,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
  },
}

export const AheadOfPace: Story = {
  args: {
    currentValue: 85,
    targetValue: 100,
    status: 'active',
    ...makePeriod({
      periodStart: new Date(Date.now() - 1000 * 3600 * 24 * 5),
      periodEnd: new Date(Date.now() + 1000 * 3600 * 24 * 10),
    }),
  },
}

export const BehindPace: Story = {
  args: {
    currentValue: 12,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
  },
}

export const OnPace: Story = {
  args: {
    currentValue: 48,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
  },
}

export const Completed: Story = {
  args: {
    currentValue: 100,
    targetValue: 100,
    status: 'completed',
    ...makePeriod(),
  },
}

export const NoPeriodOpenGoal: Story = {
  args: {
    currentValue: 67,
    targetValue: 200,
    status: 'active',
    periodStart: null,
    periodEnd: null,
  },
}

export const Small: Story = {
  args: {
    currentValue: 33,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
    size: 'sm',
  },
}

export const Large: Story = {
  args: {
    currentValue: 75,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
    size: 'lg',
    showLabel: true,
  },
}

export const InteractivePlay: Story = {
  args: {
    currentValue: 55,
    targetValue: 100,
    status: 'active',
    ...makePeriod(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Basic a11y + visible content smoke
    await expect(canvas.getByRole('progressbar')).toBeInTheDocument()
  },
}
