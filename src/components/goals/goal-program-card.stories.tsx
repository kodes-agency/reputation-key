import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import { GoalProgramCard } from './goal-program-card'
import {
  FIXTURE_ZONE,
  NOVEMBER,
  OCTOBER,
  goalBundle,
  monthRow,
  personName,
  targetChange,
  version,
} from './goal-month-target.stories.fixtures'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')
const frame = { timezone: FIXTURE_ZONE, now: NOW, personName }

// On the 20th Marco changed October from 400 to 300, also from November.
const changed = goalBundle({
  versions: [
    version('v1', 1, { effectiveTo: NOVEMBER.start }),
    version('v2', 2, {
      targetValue: 300,
      effectiveFrom: NOVEMBER.start,
      changeReason: 'target_changed',
      createdBy: 'marco',
      createdAt: at('2026-10-20T08:00:00.000Z'),
    }),
  ],
  results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
  targetChanges: [
    targetChange('lobby', 400, 300, at('2026-10-20T08:00:00.000Z'), {
      followingOutcome: 'applied',
      followingVersionId: 'v2',
    }),
  ],
})

const scheduled = goalBundle({
  status: 'scheduled',
  versions: [
    version('v1', 1, {
      effectiveFrom: NOVEMBER.start,
      createdAt: at('2026-10-21T08:00:00.000Z'),
    }),
  ],
})

const meta: Meta<typeof GoalProgramCard> = {
  title: 'Goals/GoalProgramCard',
  component: GoalProgramCard,
  args: {
    goal: changed,
    plan: monthTargetPlan(changed, NOW, FIXTURE_ZONE),
    subjectCount: 1,
    canManage: true,
    frame,
  },
}

export default meta
type Story = StoryObj<typeof meta>

/**
 * While a month runs the card shows its target and the target of the months
 * after on separate lines. The changed month says who changed it and what it
 * started at; the months after say when their target was set.
 */
export const ThisMonthAndTheMonthsAfter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thisMonth = canvas.getByText('This month:').closest('p')
    const following = canvas.getByText('From Nov 1:').closest('p')

    expect(thisMonth).toHaveTextContent(
      'This month: 300Changed by Marco Rossi on Oct 20, started at 400',
    )
    expect(following).toHaveTextContent('From Nov 1: 300set on Oct 20')
    // The line under them is about the target the month started with.
    expect(canvas.getByText('Counts from Oct 1 · set on Sep 20')).toBeInTheDocument()
    expect(canvas.queryByText('Target:')).toBeNull()
    expect(canvas.queryByText(/Version/)).toBeNull()
  },
}

/** A goal that has not started has one target, and says how its start is moved. */
export const NotStartedYet: Story = {
  args: { goal: scheduled, plan: monthTargetPlan(scheduled, NOW, FIXTURE_ZONE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(canvas.getByText('Target:').closest('p')).toHaveTextContent('Target: 400')
    expect(canvas.queryByText('This month:')).toBeNull()
    expect(canvas.getByText('Starts on Nov 1 · set on Oct 21')).toBeInTheDocument()
    expect(
      canvas.getByText('To change the start month, end this goal and set it again.'),
    ).toBeInTheDocument()
  },
}
