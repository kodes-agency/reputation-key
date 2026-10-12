import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { changeGoalMonthTarget } from '#/contexts/reporting/server/goal-month-target'
import { formatMonthName, formatShortDate } from '#/lib/format'
import { GoalMonthTargetDialog } from './goal-month-target-dialog'
import {
  FIXTURE_ZONE,
  PROGRAM_ID,
  PROPERTY_ID,
  goalBundle,
  monthAfter,
  monthOf,
  monthRow,
  version,
} from './goal-month-target.stories.fixtures'
import { openGoalProgramDialog } from './goal-program.stories.dialog'

// The dialog reads the clock when it opens, so the goal's running month is the
// month the clock is in, and every date the stories expect is worked out from
// the same clock.
const NOW = new Date()
const THIS_MONTH = monthOf(NOW)
const NEXT_MONTH = monthAfter(THIS_MONTH)
const MONTH = formatMonthName(THIS_MONTH.start, FIXTURE_ZONE) ?? ''
const NEXT = formatMonthName(NEXT_MONTH.start, FIXTURE_ZONE) ?? ''
const NEXT_DAY = formatShortDate(NEXT_MONTH.start, FIXTURE_ZONE, NOW) ?? ''
const TRIGGER = 'Change this month’s target'
/** `YYYY-MM` of a fixture month, which is cut on a UTC calendar. */
const monthKeyOfFixture = (month: typeof THIS_MONTH) =>
  `${month.start.getUTCFullYear()}-${String(month.start.getUTCMonth() + 1).padStart(2, '0')}`
const FOLLOWING = `Also use this target from ${NEXT_DAY}`

const inForce = (patch: Parameters<typeof version>[2] = {}) =>
  version('v1', 1, { effectiveFrom: THIS_MONTH.start, ...patch })

// The month runs under the first version, at 400.
const counting = goalBundle({
  versions: [inForce()],
  results: [monthRow('lobby', 'v1', THIS_MONTH)],
})

// A revision already waits for next month, at 500.
const scheduledChange = (patch: Parameters<typeof version>[2] = {}) =>
  goalBundle({
    versions: [
      inForce({ effectiveTo: NEXT_MONTH.start }),
      version('v2', 2, {
        targetValue: 500,
        effectiveFrom: NEXT_MONTH.start,
        changeReason: 'revised',
        ...patch,
      }),
    ],
    results: [monthRow('lobby', 'v1', THIS_MONTH)],
  })

type ChangeInput = Parameters<typeof changeGoalMonthTarget>[0]
type ChangeResult = Awaited<ReturnType<typeof changeGoalMonthTarget>>

// The command, as it answers a goal nothing else has touched: the month takes
// the target, and the months after take it when they were asked to.
const changeMock = fn(async (input: ChangeInput): Promise<ChangeResult> => ({
  month: { previous: input.data.expectedTarget, next: input.data.targetValue },
  following: input.data.applyToFollowing
    ? { outcome: 'applied', startsAt: NEXT_MONTH.start }
    : { outcome: 'not_requested' },
}))
const changeGoalMonthTargetFn = changeMock as unknown as typeof changeGoalMonthTarget

const meta: Meta<typeof GoalMonthTargetDialog> = {
  title: 'Goals/GoalMonthTargetDialog',
  component: GoalMonthTargetDialog,
  args: {
    changeGoalMonthTargetFn,
    property: { id: PROPERTY_ID, timezone: FIXTURE_ZONE },
    goal: counting,
    soFar: [{ name: 'Lobby', reading: { kind: 'live', value: 412, sampleCount: 412 } }],
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Opens the dialog and waits for the line that says which month changes. */
async function openDialog(canvasElement: HTMLElement) {
  const dialog = await openGoalProgramDialog(
    canvasElement,
    TRIGGER,
    /^[A-Z][a-z]+ is judged against the new target\./,
  )
  expect(
    dialog.getByText(
      `${MONTH} is judged against the new target. The goal keeps showing who changed it and what it started at.`,
    ),
  ).toBeInTheDocument()
  return dialog
}

type OpenDialog = Awaited<ReturnType<typeof openDialog>>

/** Opens the dialog on a command not yet called, and finds the checkbox for the months after. */
async function openOnFollowing(canvasElement: HTMLElement, label = FOLLOWING) {
  changeMock.mockClear()
  const dialog = await openDialog(canvasElement)
  return { dialog, following: dialog.getByRole('checkbox', { name: label }) }
}

const targetField = (dialog: OpenDialog) =>
  dialog.getByRole('spinbutton', { name: `Target for ${MONTH}` })

async function typeTarget(dialog: OpenDialog, value: string) {
  await userEvent.clear(targetField(dialog))
  await userEvent.type(targetField(dialog), value)
}

/** Presses Save target and hands back what the command was sent. */
async function save(dialog: OpenDialog) {
  await userEvent.click(dialog.getByRole('button', { name: 'Save target' }))
  await waitFor(() => expect(changeMock).toHaveBeenCalledOnce())
  return changeMock.mock.calls[0]?.[0].data
}

const noteField = (dialog: OpenDialog) =>
  dialog.getByRole('textbox', { name: 'Note Optional' })

/**
 * The first checkbox state: nothing waits for the months after, so the box is
 * ticked and its label carries the real first day. The field starts on the
 * month's target with what has counted so far under it, and the save sends
 * what the form showed, so a goal that moved on meanwhile refuses it.
 */
export const TickedWithTheRealDate: Story = {
  play: async ({ canvasElement }) => {
    const { dialog, following } = await openOnFollowing(canvasElement)

    expect(targetField(dialog)).toHaveValue(400)
    expect(targetField(dialog)).toHaveAccessibleDescription('412 so far this month')
    expect(following).toBeChecked()
    expect(following).toBeEnabled()
    expect(following).not.toHaveAccessibleDescription()

    await typeTarget(dialog, '300')
    const sent = await save(dialog)

    expect(sent).toEqual({
      propertyId: PROPERTY_ID,
      programId: PROGRAM_ID,
      month: monthKeyOfFixture(THIS_MONTH),
      targetValue: 300,
      expectedTarget: 400,
      expectedVersion: 1,
      // The month whose first day the box named: a version that would start
      // with another is refused.
      expectedFollowingMonth: monthKeyOfFixture(NEXT_MONTH),
      applyToFollowing: true,
      note: undefined,
    })
    const receipt = await dialog.findByRole('status')
    await expect(receipt).toHaveTextContent(
      `Target saved. It also applies from ${NEXT_DAY}.`,
    )
    // The receipt is the end of it: nothing is left to save or to cancel. The
    // footer's Cancel now reads Close (the corner control is named Close too).
    expect(dialog.getByRole('button', { name: 'Save target' })).toBeDisabled()
    expect(dialog.getByText('Close')).toBeEnabled()
    expect(dialog.queryByRole('button', { name: 'Cancel' })).toBeNull()
    // What was sent stays as it was sent, and the focus is on the outcome.
    expect(targetField(dialog)).toBeDisabled()
    expect(following).toBeDisabled()
    expect(noteField(dialog)).toBeDisabled()
    await waitFor(() => expect(receipt).toHaveFocus())
  },
}

/**
 * Nothing to save until the form asks for a change: the month already has the
 * number in the field, and a note is stored only with a change.
 */
export const NothingToSaveUntilSomethingChanges: Story = {
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    const dialog = await openDialog(canvasElement)
    const saveButton = dialog.getByRole('button', { name: 'Save target' })

    expect(saveButton).toBeDisabled()
    await userEvent.type(noteField(dialog), 'The pool bar is closed')
    expect(saveButton).toBeDisabled()

    await typeTarget(dialog, '300')
    await waitFor(() => expect(saveButton).toBeEnabled())
    await typeTarget(dialog, '400')
    await waitFor(() => expect(saveButton).toBeDisabled())
    expect(changeMock).not.toHaveBeenCalled()
  },
}

/**
 * The second state: a change is already scheduled for next month. The box is
 * left unticked and asks, with the number in the field, before it would
 * replace that change.
 */
export const AsksBeforeReplacingAScheduledChange: Story = {
  args: { goal: scheduledChange() },
  play: async ({ canvasElement }) => {
    const { dialog, following } = await openOnFollowing(canvasElement)

    expect(following).not.toBeChecked()
    expect(following).toBeEnabled()
    await typeTarget(dialog, '300')
    await waitFor(() =>
      expect(following).toHaveAccessibleDescription(
        `${NEXT} is already set to 500. Replace it with 300?`,
      ),
    )

    // Left unticked, only the month changes, and the receipt says where the
    // months after stay.
    const sent = await save(dialog)

    expect(sent).toMatchObject({ targetValue: 300, applyToFollowing: false })
    await expect(await dialog.findByRole('status')).toHaveTextContent(
      `Target saved. ${NEXT} stays at 500.`,
    )
    // The question was about this save; the receipt has answered it.
    expect(following).not.toHaveAccessibleDescription()
  },
}

/** Ticking the box is the answer to its question, and it is sent. */
export const ReplacesTheScheduledChangeWhenTicked: Story = {
  args: { goal: scheduledChange() },
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    changeMock.mockResolvedValueOnce({
      month: { previous: 400, next: 300 },
      following: { outcome: 'replaced_scheduled_change', startsAt: NEXT_MONTH.start },
    })
    const dialog = await openDialog(canvasElement)

    await typeTarget(dialog, '300')
    await userEvent.click(dialog.getByRole('checkbox', { name: FOLLOWING }))
    const sent = await save(dialog)

    expect(sent).toMatchObject({ applyToFollowing: true, expectedVersion: 2 })
    await expect(await dialog.findByRole('status')).toHaveTextContent(
      `Target saved. It replaces the change that was scheduled from ${NEXT_DAY}.`,
    )
  },
}

// The months were cut on a UTC calendar and the Property has since moved far
// east: its next month begins before the running one ends, so a version for the
// months after can only start with the month after next.
const EASTERN_ZONE = 'Pacific/Kiritimati'
const SKIPPED_TO = monthAfter(NEXT_MONTH)

/**
 * The third state: ticking the box would leave a month with no goal result.
 * The box is left unticked and says which month, and its label names the day
 * the target would really start.
 */
export const WarnsWhenAMonthWouldBeSkipped: Story = {
  args: { property: { id: PROPERTY_ID, timezone: EASTERN_ZONE } },
  play: async ({ canvasElement }) => {
    const { following } = await openOnFollowing(
      canvasElement,
      `Also use this target from ${formatShortDate(SKIPPED_TO.start, FIXTURE_ZONE, NOW)}`,
    )

    expect(following).not.toBeChecked()
    expect(following).toBeEnabled()
    expect(following).toHaveAccessibleDescription(`${NEXT} would have no goal result.`)
  },
}

/**
 * The months after cannot take the target: the change that waits for them has
 * another measure. The box is unavailable and says why. The save still asks
 * for them, so the command answers, and logs, that their own change was kept.
 */
export const UnavailableWhenTheScheduledChangeHasAnotherMeasure: Story = {
  args: {
    goal: scheduledChange({
      metric: 'portal_rating_average',
      metricMinimumSample: 10,
      targetValue: 4.5,
    }),
  },
  play: async ({ canvasElement }) => {
    const { dialog, following } = await openOnFollowing(canvasElement)
    changeMock.mockResolvedValueOnce({
      month: { previous: 400, next: 300 },
      following: { outcome: 'kept_scheduled_change' },
    })

    expect(following).toBeDisabled()
    expect(following).not.toBeChecked()
    expect(following).toHaveAccessibleDescription(
      `${NEXT} already has its own change scheduled, so only ${MONTH} will change.`,
    )

    await typeTarget(dialog, '300')
    const sent = await save(dialog)

    expect(sent).toMatchObject({ applyToFollowing: true })
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      `${NEXT} already has its own change scheduled, so only ${MONTH} changed.`,
    )
  },
}

/**
 * A paused goal opens no month until it is resumed, and the box says so under
 * the day it names.
 */
export const SaysAPausedGoalOpensNoMonth: Story = {
  args: {
    goal: goalBundle({
      status: 'paused',
      versions: [inForce()],
      results: [monthRow('lobby', 'v1', THIS_MONTH)],
    }),
    soFar: [],
  },
  play: async ({ canvasElement }) => {
    const { following } = await openOnFollowing(canvasElement)

    expect(following).toBeChecked()
    expect(following).toHaveAccessibleDescription(
      'This goal is paused. No month opens until it is resumed.',
    )
  },
}

/**
 * The month changed and the months after did not: the receipt says both, and
 * why, as a notice that is announced at once.
 */
export const SaysWhenTheMonthsAfterWereNotChanged: Story = {
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    changeMock.mockResolvedValueOnce({
      month: { previous: 400, next: 300 },
      following: { outcome: 'not_applied', reason: 'metric_unavailable' },
    })
    const dialog = await openDialog(canvasElement)

    await typeTarget(dialog, '300')
    await save(dialog)

    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      `${MONTH} changed. ${NEXT} was not changed because the measure is not available.`,
    )
    expect(dialog.queryByText(/not_applied|metric_unavailable/)).toBeNull()
  },
}

const refusal = (code: string) =>
  new ServerFunctionError('GoalProgramError', code, code, 409)

/** A refusal reads as a sentence above the actions, and names the month it is about. */
export const SaysARefusalInWords: Story = {
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    changeMock.mockRejectedValueOnce(refusal('month_locked'))
    const dialog = await openDialog(canvasElement)

    await typeTarget(dialog, '300')
    await save(dialog)

    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      `${MONTH} has ended. Its target can’t be changed.`,
    )
    expect(dialog.queryByText(/month_locked/)).toBeNull()
    // A refusal is not a receipt: the form can be saved again.
    expect(dialog.getByRole('button', { name: 'Save target' })).toBeEnabled()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
}

/** A goal that changed under the dialog refuses the save, in a sentence. */
export const SaysAGoalThatChangedMeanwhile: Story = {
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    changeMock.mockRejectedValueOnce(refusal('revision_conflict'))
    const dialog = await openDialog(canvasElement)

    await typeTarget(dialog, '300')
    await save(dialog)

    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'This goal changed while you were working on it. Reload the page and try again.',
    )
  },
}

/**
 * An average is set to one decimal out of five. The browser holds the field
 * to that range and step; a field left empty passes the browser, and the form
 * names it before anything is sent.
 */
export const AnAverageTakesOneDecimal: Story = {
  args: {
    goal: goalBundle({
      versions: [
        inForce({
          metric: 'portal_rating_average',
          metricMinimumSample: 10,
          targetValue: 4.5,
        }),
      ],
      results: [monthRow('lobby', 'v1', THIS_MONTH)],
    }),
    soFar: [
      { name: 'Lobby', reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 } },
    ],
  },
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    const dialog = await openDialog(canvasElement)
    const field = targetField(dialog)

    expect(field).toHaveValue(4.5)
    expect(field).toHaveAttribute('step', '0.1')
    expect(field).toHaveAttribute('max', '5')
    expect(field).toHaveAccessibleDescription(
      'Too few ratings so far this month: 6 of the 10 an average needs',
    )

    await userEvent.clear(field)
    await userEvent.click(dialog.getByRole('button', { name: 'Save target' }))

    await expect(
      await dialog.findByText('Enter a valid monthly target'),
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(changeMock).not.toHaveBeenCalled()
  },
}

/** The note is one optional field, and it is sent as written. */
export const NoteIsOptional: Story = {
  play: async ({ canvasElement }) => {
    changeMock.mockClear()
    const dialog = await openDialog(canvasElement)

    await typeTarget(dialog, '300')
    await userEvent.type(noteField(dialog), 'The pool bar is closed')
    const sent = await save(dialog)

    expect(sent?.note).toBe('The pool bar is closed')
  },
}

/** A goal with several subjects says what each has counted so far. */
export const SeveralSubjectsSoFar: Story = {
  args: {
    goal: goalBundle({
      versions: [inForce()],
      results: [monthRow('lobby', 'v1', THIS_MONTH), monthRow('pool', 'v1', THIS_MONTH)],
    }),
    soFar: [
      { name: 'Lobby', reading: { kind: 'live', value: 412, sampleCount: 412 } },
      { name: 'Pool bar', reading: { kind: 'unavailable' } },
    ],
  },
  play: async ({ canvasElement }) => {
    const dialog = await openDialog(canvasElement)

    expect(dialog.getByText('Lobby: 412 so far this month')).toBeInTheDocument()
    expect(
      dialog.getByText('Pool bar: This month’s figure can’t be read right now'),
    ).toBeInTheDocument()
  },
}

/**
 * The page was left open over the end of the month it showed: no month is
 * running in what it holds, so the dialog says so and offers nothing to save.
 */
export const NoMonthIsRunning: Story = {
  args: {
    goal: goalBundle({
      versions: [version('v1', 1, { effectiveFrom: monthAfter(THIS_MONTH, -1).start })],
      results: [monthRow('lobby', 'v1', monthAfter(THIS_MONTH, -1))],
    }),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openGoalProgramDialog(
      canvasElement,
      TRIGGER,
      /^No month of this goal is running right now/,
    )

    expect(dialog.queryByRole('spinbutton')).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Save target' })).toBeNull()
    expect(dialog.getByText('Close')).toBeEnabled()
    expect(dialog.queryByRole('button', { name: 'Cancel' })).toBeNull()
  },
}
