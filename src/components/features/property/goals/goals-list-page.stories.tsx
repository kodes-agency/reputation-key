import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GoalsListPage } from './goals-list-page'
import type { Goal, GoalProgress } from '#/contexts/goal/application/public-api'
import type { GoalWithProgress } from '#/contexts/goal/ui/helpers'
import {
  goalId,
  goalProgressId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const meta: Meta<typeof GoalsListPage> = {
  title: 'Property/GoalsListPage',
  component: GoalsListPage,
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
type Story = StoryObj<typeof GoalsListPage>

const PROPERTY_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000001')

let seq = 0
function makeGoal(overrides: Partial<Goal> & Pick<Goal, 'name'>): Goal {
  seq += 1
  return {
    id: goalId(`goal-${String(seq).padStart(3, '0')}`),
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    portalId: null,
    portalGroupId: null,
    description: null,
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
    ...overrides,
  }
}

function withProgress(goal: Goal, currentValue: number): GoalWithProgress {
  const progress: GoalProgress = {
    id: goalProgressId(`gp-${goal.id}`),
    goalId: goal.id,
    organizationId: ORG_ID,
    currentValue,
    currentSum: currentValue,
    currentCount: currentValue,
    lastComputedAt: new Date('2026-07-12T12:00:00Z'),
    computedSource: 'event_increment',
  }
  return { goal, progress }
}

const mixedGoals: readonly GoalWithProgress[] = [
  withProgress(
    makeGoal({
      name: 'Behind July scans',
      targetValue: 80,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    }),
    4,
  ),
  withProgress(
    makeGoal({
      name: 'On-track review clicks',
      metricKey: 'portal.review_link_click',
      targetValue: 30,
      createdAt: new Date('2026-07-02T09:00:00Z'),
    }),
    20,
  ),
  withProgress(
    makeGoal({
      name: 'Rolling rating quality',
      goalType: 'rolling',
      metricKey: 'portal.rating',
      aggregationFunction: 'avg',
      targetValue: 4.6,
      periodStart: null,
      periodEnd: null,
      rollingWindowDays: 30,
      createdAt: new Date('2026-07-03T09:00:00Z'),
    }),
    4.4,
  ),
  withProgress(
    makeGoal({
      name: 'Completed Q2 scans',
      status: 'completed',
      targetValue: 40,
      completedAt: new Date('2026-06-30T17:00:00Z'),
      createdAt: new Date('2026-05-01T09:00:00Z'),
      updatedAt: new Date('2026-06-30T17:00:00Z'),
    }),
    44,
  ),
  withProgress(
    makeGoal({
      name: 'Expired May scans',
      status: 'expired',
      targetValue: 30,
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-31T23:59:59Z'),
      createdAt: new Date('2026-04-01T09:00:00Z'),
      updatedAt: new Date('2026-06-01T09:00:00Z'),
    }),
    18,
  ),
]

export const Empty: Story = {
  args: {
    goals: [],
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
    view: 'active',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Goals' })).toBeVisible()
    expect(canvas.getByText(/no goals yet/i)).toBeVisible()
    expect(canvas.getAllByRole('link', { name: /new goal/i })[0]).toBeVisible()
  },
}

export const Active: Story = {
  args: {
    goals: mixedGoals,
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
    view: 'active',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Needs attention' })).toBeVisible()
    expect(canvas.getByText('Behind July scans')).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'On track' })).toBeVisible()
    expect(canvas.getByText('On-track review clicks')).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Other active goals' })).toBeVisible()
    expect(canvas.getByText('Rolling rating quality')).toBeVisible()
    expect(canvas.queryByText('Completed Q2 scans')).toBeNull()
  },
}

export const History: Story = {
  args: {
    goals: mixedGoals,
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
    view: 'history',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Completed' })).toBeVisible()
    expect(canvas.getByText('Completed Q2 scans')).toBeVisible()
    expect(canvas.getByRole('heading', { name: 'Expired' })).toBeVisible()
    expect(canvas.getByText('Expired May scans')).toBeVisible()
    expect(canvas.queryByText('Behind July scans')).toBeNull()
  },
}

export const HistoryFiltered: Story = {
  args: {
    ...History.args,
    historyStatus: 'expired',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Expired' })).toBeVisible()
    expect(canvas.getByText('Expired May scans')).toBeVisible()
    expect(canvas.queryByText('Completed Q2 scans')).toBeNull()
  },
}
