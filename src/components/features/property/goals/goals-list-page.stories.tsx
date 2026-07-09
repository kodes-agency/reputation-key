// Goals list page — header + empty state, or a grid of goal cards sorted by
// status bucket (active → completed → expired → cancelled) then newest-first.
// Fully prop-driven: `goals` are plain `GoalWithProgress` shapes (no
// server/RPC). Branded IDs are built via the shared id constructors. The page
// uses TanStack `Link`, rendered fine by the global memory router in preview.
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
    lastComputedAt: new Date('2026-07-05T12:00:00Z'),
    computedSource: 'event_increment',
  }
  return { goal, progress }
}

// Empty list — the page renders its empty state, but the header "New Goal"
// action stays available so a goal can be created from scratch.
export const Empty: Story = {
  args: {
    goals: [],
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Goals' })).toBeVisible()
    expect(canvas.getByText(/no goals yet/i)).toBeVisible()
    // Header primary action always renders, regardless of list state.
    expect(canvas.getByRole('link', { name: /new goal/i })).toBeVisible()
  },
}

// Populated list — goals are passed in NON-sorted order (an older completed
// goal, a newer active goal, then an expired goal). The page sorts by status
// bucket (active → completed → expired) then createdAt desc, so the rendered
// card order becomes active, completed, expired — asserted in the play fn.
const populatedGoals: readonly GoalWithProgress[] = [
  withProgress(
    makeGoal({
      name: 'Completed Q2 scans',
      status: 'completed',
      targetValue: 40,
      completedAt: new Date('2026-06-30T17:00:00Z'),
      createdAt: new Date('2026-05-01T09:00:00Z'),
    }),
    44,
  ),
  withProgress(
    makeGoal({
      name: 'Active July scans',
      status: 'active',
      targetValue: 50,
      createdAt: new Date('2026-06-15T09:00:00Z'),
    }),
    23,
  ),
  withProgress(
    makeGoal({
      name: 'Expired May scans',
      status: 'expired',
      targetValue: 30,
      createdAt: new Date('2026-04-01T09:00:00Z'),
    }),
    18,
  ),
]

export const Populated: Story = {
  args: {
    goals: populatedGoals,
    propertyId: 'prop-00000000-0000-0000-0000-000000000001',
    propertyName: 'Harborline Suites',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // No empty state once goals exist.
    expect(canvas.queryByText(/no goals yet/i)).toBeNull()

    // The page sorts by status bucket before rendering, so the active goal
    // card precedes the completed one, which precedes the expired one —
    // despite being passed in the opposite order.
    const links = canvas.getAllByRole('link')
    const order = links.map((l) => l.textContent ?? '')
    const activeIdx = order.findIndex((t) => t.includes('Active July scans'))
    const completedIdx = order.findIndex((t) => t.includes('Completed Q2 scans'))
    const expiredIdx = order.findIndex((t) => t.includes('Expired May scans'))
    expect(activeIdx).toBeGreaterThan(-1)
    expect(completedIdx).toBeGreaterThan(activeIdx)
    expect(expiredIdx).toBeGreaterThan(completedIdx)

    // Each status bucket surfaces its badge.
    expect(canvas.getByText('Active')).toBeVisible()
    expect(canvas.getByText('Completed')).toBeVisible()
    expect(canvas.getByText('Expired')).toBeVisible()
  },
}
