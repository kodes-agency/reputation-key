// Goal detail page — honest progress summary, lifecycle-aware settings,
// confirmation-based cancellation, and recurring instance history.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GoalDetailPage } from './goal-detail-page'
import type { Goal, GoalProgress } from '#/contexts/goal/application/public-api'
import type { GoalWithProgress } from '#/contexts/goal/ui/helpers'
import {
  goalId,
  goalProgressId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const meta: Meta<typeof GoalDetailPage> = {
  title: 'Property/GoalDetailPage',
  component: GoalDetailPage,
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
type Story = StoryObj<typeof GoalDetailPage>

const PROPERTY_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000001')
const GOAL_ID = goalId('goal-00000000-0000-0000-0000-000000000001')

// Frozen render clock — pace/remaining labels are computed against `now`
// (BQC-5.3: the page defaults the prop to the wall clock; stories pin it).
const STORY_NOW = new Date('2026-07-21T00:00:00Z')

const activeGoal: Goal = {
  id: GOAL_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  portalId: null,
  portalGroupId: null,
  name: '50 scans this month',
  description: 'Drive QR scan volume across all portals.',
  createdBy: userId('user-00000000-0000-0000-0000-000000000001'),
  goalType: 'one_shot',
  aggregationFunction: 'sum',
  metricKey: 'portal.scan',
  targetValue: 50,
  status: 'active',
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-31T23:59:59Z'),
  recurrenceRule: null,
  rollingWindowDays: null,
  parentGoalId: null,
  completedAt: null,
  createdAt: new Date('2026-06-15T09:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
}

const inProgress: GoalProgress = {
  id: goalProgressId('gp-00000000-0000-0000-0000-000000000001'),
  goalId: GOAL_ID,
  organizationId: ORG_ID,
  currentValue: 32,
  currentSum: 32,
  currentCount: 32,
  lastComputedAt: new Date('2026-07-05T12:00:00Z'),
  computedSource: 'event_increment',
}

export const ActiveWithProgress: Story = {
  args: {
    goal: activeGoal,
    progress: inProgress,
    instances: [],
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
    onCancel: () => {},
    isCancelling: false,
    canCancelGoal: true,
    now: STORY_NOW,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Goal name renders in the header.
    expect(canvas.getByRole('heading', { name: '50 scans this month' })).toBeVisible()
    // Active status badge + scope/metric details render.
    expect(canvas.getAllByText('Active')[0]).toBeVisible()
    expect(canvas.getByText('Scans')).toBeVisible()
    // Cancel action is available for an active goal.
    expect(canvas.getByRole('button', { name: /cancel goal/i })).toBeVisible()
  },
}

// No progress computed yet — progress bar shows 0 / target.
export const ActiveNoProgress: Story = {
  args: { ...ActiveWithProgress.args, progress: null },
}

// Cancel in flight — button shows the cancelling label + is disabled.
export const Cancelling: Story = {
  args: { ...ActiveWithProgress.args, isCancelling: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cancelBtn = canvas.getByRole('button', { name: /cancelling/i })
    await expect(cancelBtn).toBeDisabled()
  },
}

// Completed goal — no cancel action, completion date shown.
export const Completed: Story = {
  args: {
    ...ActiveWithProgress.args,
    goal: {
      ...activeGoal,
      status: 'completed',
      completedAt: new Date('2026-06-30T17:00:00Z'),
      targetValue: 50,
    },
    progress: { ...inProgress, currentValue: 55 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByText('Completed')[0]).toBeVisible()
    // No cancel button once the goal is no longer active.
    expect(canvas.queryByRole('button', { name: /cancel goal/i })).toBeNull()
  },
}

export const Expired: Story = {
  args: {
    ...ActiveWithProgress.args,
    goal: {
      ...activeGoal,
      status: 'expired',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T23:59:59Z'),
      targetValue: 50,
    },
    progress: { ...inProgress, currentValue: 21 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByText('Expired')[0]).toBeVisible()
    expect(canvas.getByText(/short/i)).toBeVisible()
    expect(canvas.queryByRole('button', { name: /cancel goal/i })).toBeNull()
  },
}

export const ReadOnlyActive: Story = {
  args: {
    ...ActiveWithProgress.args,
    canCancelGoal: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /cancel goal/i })).toBeNull()
  },
}

// Recurring template — renders the instance history table for prior periods.
function makeInstance(
  id: string,
  status: Goal['status'],
  currentValue: number,
): GoalWithProgress {
  const instanceGoal: Goal = {
    ...activeGoal,
    id: goalId(id),
    status,
    parentGoalId: GOAL_ID,
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-06-30T23:59:59Z'),
  }
  return {
    goal: instanceGoal,
    progress: { ...inProgress, id: goalProgressId(`gp-${id}`), currentValue },
  }
}

export const RecurringTemplate: Story = {
  args: {
    ...ActiveWithProgress.args,
    goal: {
      ...activeGoal,
      goalType: 'recurring',
      recurrenceRule: { frequency: 'monthly' },
      periodStart: null,
      periodEnd: null,
    },
    instances: [
      makeInstance('inst-1', 'completed', 58),
      makeInstance('inst-2', 'active', 32),
      makeInstance('inst-3', 'expired', 21),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Instance history table renders for a recurring template.
    expect(canvas.getByRole('heading', { name: /instance history/i })).toBeVisible()
    expect(canvas.getByText('Period')).toBeVisible()
  },
}
