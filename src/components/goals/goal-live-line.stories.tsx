// The live line under an active goal on the Goals list (Portal goals, decision
// 14). It is the month so far, never the month's result: a count with one
// subject gets its figure of the target, the days left and a neutral bar, and
// where the pace was judged the shared pill, "On pace" or "Below pace" (ADR
// 0068, amended 2026-10-19), after the days left where the cell has room, beside
// the bar where it has not, so the pill never adds a line; a month the rule does
// not judge has no pill; an average gets its figure against the target and no
// pace; a goal with several subjects says how many are below pace, as words. A
// figure that cannot be read says so, and an average too thin to show asks for
// more ratings. Dark is the default theme; the Light variants draw the same
// lines on the light surface, and axe checks both.
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

/** The sentence of the default goal, whatever pill it wears. */
function expectTheCountSentence(canvasElement: HTMLElement) {
  const line = canvasElement.querySelector('[data-slot="goal-live-line"]')
  expect(line?.querySelector('p')).toHaveTextContent(/^64 of 120 so far · 15 days left$/)
}

/** The pill of a line: one badge, in the slot the metrics read, in this tone. */
function expectThePill(
  canvas: ReturnType<typeof within>,
  label: string,
  variant: string,
) {
  const pill = canvas.getByText(label)
  expect(pill).toBeVisible()
  expect(pill).toHaveAttribute('data-slot', 'badge')
  expect(pill).toHaveAttribute('data-variant', variant)
  expect(pill.closest('[data-slot="goal-live-pace"]')).not.toBeNull()
}

/** The placeholder above the line that replaces it, as a row keeps them while its month is read. */
function PendingAbove({ live }: Readonly<{ live: GoalListProgress }>) {
  return (
    <div className="flex flex-col gap-6">
      <GoalLiveLinePending shape="line_and_bar" />
      <GoalLiveLine goal={live} />
    </div>
  )
}

/** The placeholder is hidden from assistive technology; only the loaded line is a bar a reader can find. */
function expectOnlyTheLineIsABar(canvasElement: HTMLElement) {
  const pending = canvasElement.querySelector('[data-slot="goal-live-line-pending"]')
  expect(pending).toHaveAttribute('aria-hidden', 'true')
  expect(within(canvasElement).getAllByRole('progressbar')).toHaveLength(1)
}

/**
 * One count subject whose pace the rule did not judge (the month's first days,
 * or too few expected so far): the figure of the target, the days left and a
 * neutral bar, and no pill.
 */
export const OneCountSubject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('64 of 120 so far · 15 days left')).toBeVisible()
    expect(canvasElement.querySelector('[data-slot="goal-live-pace"]')).toBeNull()
    expect(canvas.queryByText(/pace/iu)).toBeNull()
    const bar = canvas.getByRole('progressbar', {
      name: 'Scans so far this month',
    })
    expect(bar).toHaveAttribute('aria-valuenow', '64')
    expect(bar).toHaveAttribute('aria-valuemax', '120')
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 120 so far')
    expect(bar).toHaveAttribute('data-tone', 'neutral')
  },
}

/**
 * A count below pace wears the shared "Below pace" pill, apart from the sentence:
 * after the days left where the cell has room, beside the bar where it has not
 * (the story's own width is wide; `NarrowCellBelowPace` is the phone's). The
 * words and the bar stay neutral: the pill is the one verdict.
 */
export const OneCountSubjectBelowPace: Story = {
  args: { goal: goal({ belowPace: 1 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheCountSentence(canvasElement)
    expectThePill(canvas, 'Below pace', 'warn')
    const bar = canvas.getByRole('progressbar', {
      name: 'Scans so far this month',
    })
    expect(bar).toHaveAttribute('aria-valuetext', '64 of 120 so far')
    expect(bar).toHaveAttribute('data-tone', 'neutral')
  },
}

/** A count that keeps up wears the shared "On pace" pill, in the same place. */
export const OneCountSubjectOnPace: Story = {
  args: { goal: goal({ belowPace: 0 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectTheCountSentence(canvasElement)
    expectThePill(canvas, 'On pace', 'positive')
    expect(canvas.getByRole('progressbar')).toHaveAttribute('data-tone', 'neutral')
  },
}

/**
 * In the cell of a row on a 375 px phone (about 230 px) the sentence and the
 * pill do not fit one line, so the pill sits beside the bar and the row keeps its
 * height. The geometry is measured in Storybook proper
 * (`e2e/storybook-metrics/goal-live-line.metrics.ts`).
 */
export const NarrowCellBelowPace: Story = {
  args: { goal: goal({ belowPace: 1 }) },
  decorators: [
    (Story) => (
      <div style={{ width: 230 }}>
        <Story />
      </div>
    ),
  ],
  play: OneCountSubjectBelowPace.play,
}

/** The same narrow cell with the "On pace" pill: it takes the room "Below pace" does. */
export const NarrowCellOnPace: Story = {
  args: { goal: goal({ belowPace: 0 }) },
  decorators: NarrowCellBelowPace.decorators,
  play: OneCountSubjectOnPace.play,
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
    expect(canvas.getByText('1,530 of 1,200 so far · 15 days left')).toBeVisible()
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
    expect(canvas.getByText('4.6 so far · target 4.5 · 15 days left')).toBeVisible()
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
        'More ratings needed · 4 of 10 so far · target 4.5 · 15 days left',
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
  render: () => <PendingAbove live={goal()} />,
  play: async ({ canvasElement }) => {
    const pending = canvasElement.querySelector('[data-slot="goal-live-line-pending"]')
    expect(pending?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
    expectOnlyTheLineIsABar(canvasElement)
    expect(
      within(canvasElement).getByText('64 of 120 so far · 15 days left'),
    ).toBeVisible()
  },
}

/**
 * Whether a count has a pill, and which, is known only with its figure, so the
 * room kept while it is read is the same either way: the pill never adds a line
 * to the sentence, and the row it sits in is as high as the pill
 * (`e2e/storybook-metrics/goal-live-line.metrics.ts` measures it from a 200 px
 * cell to a desktop's).
 */
export const PendingKeepsTheRoomOfACountBelowPace: Story = {
  render: () => <PendingAbove live={goal({ belowPace: 1 })} />,
  play: async ({ canvasElement }) => {
    expectOnlyTheLineIsABar(canvasElement)
    expect(within(canvasElement).getByText('Below pace')).toBeVisible()
  },
}

/** The same room again when the line that arrives wears "On pace". */
export const PendingKeepsTheRoomOfACountOnPace: Story = {
  render: () => <PendingAbove live={goal({ belowPace: 0 })} />,
  play: async ({ canvasElement }) => {
    expectOnlyTheLineIsABar(canvasElement)
    expect(within(canvasElement).getByText('On pace')).toBeVisible()
  },
}

/** The widest figures a row has: the longest sentence the pill has to make room for. */
export const PendingKeepsTheRoomOfACountOfFiveDigitsBelowPace: Story = {
  render: () => (
    <PendingAbove
      live={goal({
        belowPace: 1,
        metric: 'portal_rating_count',
        month: {
          reading: { kind: 'live', value: 12345, sampleCount: 12345 },
          targetValue: 15000,
        },
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('12,345 of 15,000 so far · 15 days left')).toBeVisible()
    expect(canvas.getByText('Below pace')).toBeVisible()
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
export const OneCountSubjectOnPaceLight: Story = {
  ...OneCountSubjectOnPace,
  parameters: { theme: 'light' },
}
export const SeveralSubjectsBelowPaceLight: Story = {
  ...SeveralSubjectsBelowPace,
  parameters: { theme: 'light' },
}
