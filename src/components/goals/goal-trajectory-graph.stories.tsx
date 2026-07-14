// GoalTrajectoryGraph stories — actual vs expected lines/areas over time.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { GoalTrajectoryGraph } from './goal-trajectory-graph'

const meta: Meta<typeof GoalTrajectoryGraph> = {
  title: 'Goals/GoalTrajectoryGraph',
  component: GoalTrajectoryGraph,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof GoalTrajectoryGraph>

const sample = [
  { t: '2026-07-01T00:00:00Z', actual: 0, expected: 0 },
  { t: '2026-07-08T00:00:00Z', actual: 18, expected: 25 },
  { t: '2026-07-15T00:00:00Z', actual: 47, expected: 50 },
  { t: '2026-07-22T00:00:00Z', actual: 72, expected: 75 },
  { t: '2026-07-28T00:00:00Z', actual: 91, expected: 90 },
]

export const Area: Story = {
  args: {
    data: sample,
    targetValue: 100,
    variant: 'area',
  },
}

export const Line: Story = {
  args: {
    data: sample,
    targetValue: 100,
    variant: 'line',
  },
}

export const BehindEarly: Story = {
  args: {
    data: [
      { t: '2026-07-01', actual: 0, expected: 0 },
      { t: '2026-07-10', actual: 12, expected: 33 },
      { t: '2026-07-20', actual: 29, expected: 66 },
      { t: '2026-07-31', actual: 55, expected: 100 },
    ],
    targetValue: 100,
  },
}

export const Empty: Story = {
  args: {
    data: [],
    targetValue: 50,
  },
}
