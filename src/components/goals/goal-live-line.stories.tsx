// The live line under an active goal on the Goals list (Portal goals, decision
// 14). It is the month so far, never the month's result: a count with one
// subject gets its figure of the target, the days left and a neutral bar, and
// when it is below pace the quiet amber words "below pace" after them; an
// average gets its figure against the target and no pace; a goal with several
// subjects says how many are below pace. A figure that cannot be read says so,
// and an average too thin to show asks for more ratings. Dark is the default
// theme; the Light variants draw the same lines on the light surface, and axe
// checks both.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { GoalLiveLine, GoalLiveLinePending } from './goal-live-line'

const goal = (patch: Partial<GoalListProgress> = {}): GoalListProgress => ({
  programId: 'program-1',
  metric: 'qualified_scans',
  subjectCount: 1,
  daysLeft: 14,
  month: { reading: { kind: 'live', value: 64, sampleCount: 64 }, targetValue: 120 },
  belowPace: null,
  ...patch,
})

const meta: Meta<typeof GoalLiveLine> = {
  title: 'Goals/GoalLiveLine',
  component: GoalLiveLine,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { goal: goal() },
}

export default meta
type Story = StoryObj<typeof GoalLiveLine>

/** One count subject: the figure of the target, the days left and a neutral bar. */
export const OneCountSubject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('64 of 120 so far · 14 days left')).toBeVisible()
    const bar = canvas.getByRole('progressbar', {
      name: 'Qualified scans so far this month',
    })
    expect(bar).toHaveAttribute('aria-valuenow', '64')
    expect(bar).toHaveAttribute('aria-valuemax', '120')
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 120 so far')
    expect(bar).toHaveAttribute('data-tone', 'neutral')
  },
}

/**
 * A count below pace says so after the days left, in quiet amber text. The bar
 * stays neutral: the amber is two words and a nudge, not a verdict.
 */
export const OneCountSubjectBelowPace: Story = {
  args: { goal: goal({ belowPace: 1 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvasElement.querySelector('[data-slot="goal-live-line"] p'),
    ).toHaveTextContent('64 of 120 so far · 14 days left · below pace')
    const note = canvas.getByText('below pace')
    expect(note).toBeVisible()
    expect(note).toHaveClass('text-warn')
    const bar = canvas.getByRole('progressbar', {
      name: 'Qualified scans so far this month',
    })
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 120 so far')
    expect(bar).toHaveAttribute('data-tone', 'neutral')
  },
}

/** Past the target the bar is full and the words keep the count. */
export const PastTheTarget: Story = {
  args: {
    goal: goal({
      metric: 'portal_rating_count',
      month: {
        reading: { kind: 'live', value: 1530, sampleCount: 1530 },
        targetValue: 1200,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('1,530 of 1,200 so far · 14 days left')).toBeVisible()
    expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1200')
  },
}

/** The last day of the month has no days left after today. */
export const LastDay: Story = {
  args: { goal: goal({ daysLeft: 0 }) },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('64 of 120 so far · last day')).toBeVisible()
  },
}

/** One average subject: the average so far against the target, and no bar. */
export const OneAverageSubject: Story = {
  args: {
    goal: goal({
      metric: 'portal_rating_average',
      month: {
        reading: { kind: 'live', value: 4.62, sampleCount: 31 },
        targetValue: 4.5,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('4.6 so far · target 4.5 · 14 days left')).toBeVisible()
    expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** Below the measure's minimum sample there is no average to show. */
export const MoreRatingsNeeded: Story = {
  args: {
    goal: goal({
      metric: 'portal_rating_average',
      month: {
        reading: { kind: 'too_few', sampleCount: 4, minimumSample: 10 },
        targetValue: 4.5,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByText(
        'More ratings needed · 4 of 10 so far · target 4.5 · 14 days left',
      ),
    ).toBeVisible()
    expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** A figure that cannot be read is said so: never a zero, never a bar. */
export const FigureCannotBeRead: Story = {
  args: {
    goal: goal({ month: { reading: { kind: 'unavailable' }, targetValue: 120 } }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('This month’s figure can’t be read right now')).toBeVisible()
    expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** Several subjects on a count: how many are below pace, and no bar. */
export const SeveralSubjectsBelowPace: Story = {
  args: { goal: goal({ subjectCount: 3, month: null, belowPace: 2 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('3 subjects · 2 below pace')).toBeVisible()
    expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** When every subject keeps up the line says so in words. */
export const SeveralSubjectsKeepingUp: Story = {
  args: { goal: goal({ subjectCount: 3, month: null, belowPace: 0 }) },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('3 subjects · none below pace')).toBeVisible()
  },
}

/** An average has no pace, and the first days of a month are not judged. */
export const SeveralSubjectsNotJudged: Story = {
  args: {
    goal: goal({
      metric: 'portal_rating_average',
      subjectCount: 3,
      month: null,
      belowPace: null,
    }),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('3 subjects')).toBeVisible()
  },
}

/**
 * While the month is read, a count keeps the room of its line and its bar, so
 * the rows below do not jump when the figure arrives. The Vitest story runner
 * compiles no Tailwind, so what it can say is what the placeholder is; that it
 * is exactly as high as the line is measured in Storybook proper
 * (`e2e/storybook-metrics/goal-live-line.metrics.ts`).
 */
export const PendingKeepsTheRoomOfACount: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <GoalLiveLinePending shape="line_and_bar" />
      <GoalLiveLine goal={goal()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pending = canvasElement.querySelector('[data-slot="goal-live-line-pending"]')
    expect(pending).toHaveAttribute('aria-hidden', 'true')
    expect(pending?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
    // Only the loaded line is a bar a reader can find.
    expect(canvas.getAllByRole('progressbar')).toHaveLength(1)
    expect(canvas.getByText('64 of 120 so far · 14 days left')).toBeVisible()
  },
}

/**
 * Whether a count is below pace is known only with its figure, so the room kept
 * while it is read is the same either way. Where the line fits, the note adds
 * no line to it: it is as high as the placeholder
 * (`e2e/storybook-metrics/goal-live-line.metrics.ts` measures it, and says where
 * a phone's narrow cell stops fitting).
 */
export const PendingKeepsTheRoomOfACountBelowPace: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <GoalLiveLinePending shape="line_and_bar" />
      <GoalLiveLine goal={goal({ belowPace: 1 })} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pending = canvasElement.querySelector('[data-slot="goal-live-line-pending"]')
    expect(pending).toHaveAttribute('aria-hidden', 'true')
    expect(canvas.getAllByRole('progressbar')).toHaveLength(1)
    expect(canvas.getByText('below pace')).toBeVisible()
  },
}

/** An average, or a goal of several subjects, keeps a line and no bar. */
export const PendingKeepsTheRoomOfALine: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <GoalLiveLinePending shape="line" />
      <GoalLiveLine goal={goal({ subjectCount: 3, month: null, belowPace: 2 })} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const pending = canvasElement.querySelector('[data-slot="goal-live-line-pending"]')
    expect(pending).toHaveAttribute('aria-hidden', 'true')
    expect(pending?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1)
    expect(within(canvasElement).queryByRole('progressbar')).toBeNull()
    expect(within(canvasElement).getByText('3 subjects · 2 below pace')).toBeVisible()
  },
}

export const OneCountSubjectLight: Story = {
  ...OneCountSubject,
  parameters: { theme: 'light' },
}
export const OneCountSubjectBelowPaceLight: Story = {
  ...OneCountSubjectBelowPace,
  parameters: { theme: 'light' },
}
export const SeveralSubjectsBelowPaceLight: Story = {
  ...SeveralSubjectsBelowPace,
  parameters: { theme: 'light' },
}
