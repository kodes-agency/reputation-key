import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { GoalTargetChanges } from './goal-target-changes'
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
const OCT_20 = at('2026-10-20T08:00:00.000Z')

// September ran at 350. A revision in September set 400 from October. On the
// 5th of October Marco changed October to 300 and left the months after alone;
// on the 20th he changed it to 380, also from November, with a note.
const changedTwice = goalBundle({
  versions: [
    version('v0', 1, {
      targetValue: 350,
      effectiveFrom: at('2026-09-01T00:00:00.000Z'),
      effectiveTo: OCTOBER.start,
      createdAt: at('2026-08-20T08:00:00.000Z'),
    }),
    version('v1', 2, {
      effectiveTo: NOVEMBER.start,
      changeReason: 'Busy season ahead',
      createdAt: at('2026-09-12T08:00:00.000Z'),
    }),
    version('v2', 3, {
      targetValue: 380,
      effectiveFrom: NOVEMBER.start,
      changeReason: 'target_changed',
      createdBy: 'marco',
      createdAt: OCT_20,
    }),
  ],
  results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 380 })],
  targetChanges: [
    targetChange('lobby', 400, 300, at('2026-10-05T08:00:00.000Z')),
    targetChange('lobby', 300, 380, OCT_20, {
      followingOutcome: 'applied',
      followingVersionId: 'v2',
      note: 'The pool bar reopened.',
    }),
  ],
})

const meta: Meta<typeof GoalTargetChanges> = {
  title: 'Goals/GoalTargetChanges',
  component: GoalTargetChanges,
  args: {
    goal: changedTwice,
    frame: {
      timezone: FIXTURE_ZONE,
      now: at('2026-10-22T09:00:00.000Z'),
      personName,
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

/**
 * Month changes and version changes on one rail, newest first, each with who,
 * when, the old and the new value, what became of the months after, and the
 * note. The version the change of the 20th wrote for November is told on that
 * change's line and not listed a second time.
 */
export const MonthAndVersionChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Target changes' }),
    ).toBeInTheDocument()

    const lines = canvas
      .getAllByRole('time')
      .map((time) => time.parentElement?.textContent)
    expect(lines).toEqual([
      'Marco Rossi changed October’s target from 300 to 380 · Oct 20',
      'Marco Rossi changed October’s target from 400 to 300 · Oct 5',
      'Elena Petrova changed the target from 350 to 400 · Sep 12',
    ])
    expect(canvas.getByText('Also applies from Nov 1.')).toBeInTheDocument()
    expect(canvas.getByText('Note: The pool bar reopened.')).toBeInTheDocument()
    expect(canvas.getByText('Only October changed.')).toBeInTheDocument()
    expect(canvas.getByText('Applies from Oct 1.')).toBeInTheDocument()
    expect(canvas.getByText('Note: Busy season ahead')).toBeInTheDocument()
    // A machine-readable instant behind each day.
    expect(canvas.getAllByRole('time').at(0)).toHaveAttribute(
      'datetime',
      OCT_20.toISOString(),
    )
  },
}

/**
 * The months after a month change were replaced before they began: the line
 * says they never took effect, and the plan that replaced them is read against
 * the plan that was in force.
 */
export const AFollowingTargetThatNeverTookEffect: Story = {
  args: {
    goal: goalBundle({
      versions: [
        version('v1', 1, { effectiveTo: NOVEMBER.start }),
        version('v2', 2, {
          targetValue: 300,
          effectiveFrom: NOVEMBER.start,
          effectiveTo: NOVEMBER.start,
          changeReason: 'target_changed',
          createdBy: 'marco',
          createdAt: OCT_20,
        }),
        version('v3', 3, {
          targetValue: 350,
          effectiveFrom: NOVEMBER.start,
          changeReason: 'revised',
          createdAt: at('2026-10-21T08:00:00.000Z'),
        }),
      ],
      results: [monthRow('lobby', 'v1', OCTOBER, { targetValue: 300 })],
      targetChanges: [
        targetChange('lobby', 400, 300, OCT_20, {
          followingOutcome: 'applied',
          followingVersionId: 'v2',
        }),
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(
      canvas.getByText(/^Elena Petrova changed the target from 400 to 350/),
    ).toBeInTheDocument()
    expect(
      canvas.getByText('Was also set from Nov 1, but that never took effect.'),
    ).toBeInTheDocument()
    expect(canvas.getAllByRole('time')).toHaveLength(2)
  },
}

/** Someone who has left the organization is a former member, never an identifier. */
export const AFormerMember: Story = {
  args: {
    frame: {
      timezone: FIXTURE_ZONE,
      now: at('2026-10-22T09:00:00.000Z'),
      personName: (userId) => (userId === 'elena' ? 'Elena Petrova' : 'a former member'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(
      canvas.getByText(/^A former member changed October’s target from 300 to 380/),
    ).toBeInTheDocument()
    expect(canvas.queryByText(/marco/)).toBeNull()
  },
}

/** A goal nobody has changed says so in one line. */
export const NoChanges: Story = {
  args: {
    goal: goalBundle({
      versions: [version('v1', 1)],
      results: [monthRow('lobby', 'v1')],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(
      canvas.getByText('This goal’s target has not been changed.'),
    ).toBeInTheDocument()
    expect(canvas.queryAllByRole('time')).toHaveLength(0)
  },
}
