// GoalBulkTable: one number per Portal or Portal Group, one save, one goal per
// filled row. The Storybook Vitest project compiles no Tailwind, so the plays
// pin behaviour and wiring: which rows take a number, what a save sends, what
// each row and the live region say afterwards, where the focus goes, that a
// row that got no goal can be sent again, that a number stays with the measure
// it was typed for, and what a save refused or lost as a whole leaves. Dark is
// the default theme; the light variant draws the same table on the light
// surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { GoalBulkTable } from './goal-bulk-table'
import { goalStartChoice } from './goal-start-view'
import {
  BAR_ID,
  BAR_RATINGS,
  BULK_GROUPS,
  BULK_PORTALS,
  BULK_PROPERTY,
  EARLY_IN_OCTOBER,
  FLOOR_ID,
  FLOOR_RATINGS,
  LOBBY_ID,
  LOBBY_RATINGS,
  LOBBY_RATINGS_ENDED,
} from './goal-bulk.stories.fixtures'

type SaveInput = Parameters<typeof createGoalsForSubjects>[0]
type SaveResult = Awaited<ReturnType<typeof createGoalsForSubjects>>
type Outcome = SaveResult['outcomes'][number]

const BAR = { kind: 'portal', portalId: BAR_ID } as const
const LOBBY = { kind: 'portal', portalId: LOBBY_ID } as const
const FLOOR = { kind: 'portal_group', portalGroupId: FLOOR_ID } as const
/** The group's number says that it is a group's: a Portal may share its name. */
const FLOOR_FIELD = 'First floor (portal group)'

/** A save that answers each row with `answer`, as the command would. */
const saveThat = (
  answer: (item: SaveInput['data']['items'][number]) => Outcome['code'],
) =>
  fn(async (input: SaveInput): Promise<SaveResult> => {
    const outcomes = input.data.items.map((item, index): Outcome => {
      const code = answer(item)
      return code === 'created'
        ? { subject: item.subject, code, programId: `program-new-${index + 1}` }
        : { subject: item.subject, code }
    })
    return { outcomes }
  })

const savesAll = saveThat(() => 'created')
const refusesTheGroup = saveThat((item) =>
  item.subject.kind === 'portal_group' ? 'subject_has_goal' : 'created',
)
const monthHasChanged = fn(async (_input: SaveInput): Promise<SaveResult> => {
  throw new ServerFunctionError(
    'GoalProgramError',
    'The start month is no longer offered',
    'start_month_changed',
    409,
  )
})
const refusal = (code: string, status: number) =>
  new ServerFunctionError('GoalProgramError', code, code, status)
// The command sends the code as the message too: the table must not print it.
const propertyIsGone = fn(async (_input: SaveInput): Promise<SaveResult> => {
  throw refusal('not_found', 404)
})
const failsOnTheWay = fn(async (_input: SaveInput): Promise<SaveResult> => {
  throw new Error('Failed to fetch')
})
/** A save that answers only when the play lets it, to look at the table meanwhile. */
const held: { release: () => void } = { release: () => undefined }
const savesWhenReleased = fn(
  (input: SaveInput) =>
    new Promise<SaveResult>((resolve) => {
      held.release = () =>
        resolve({
          outcomes: input.data.items.map((item, index) => ({
            subject: item.subject,
            code: 'created',
            programId: `program-held-${index + 1}`,
          })),
        })
    }),
)
const asSave = (mock: unknown) => mock as typeof createGoalsForSubjects

const onMonthChanged = fn()
const readAgain = fn()

const meta: Meta<typeof GoalBulkTable> = {
  title: 'Goals/GoalBulkTable',
  component: GoalBulkTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    createGoalsForSubjectsFn: asSave(savesAll),
    property: BULK_PROPERTY,
    groups: BULK_GROUPS,
    portals: BULK_PORTALS,
    programs: [LOBBY_RATINGS],
    goalsRead: { failed: false, retrying: false, readAgain },
    start: goalStartChoice(EARLY_IN_OCTOBER, BULK_PROPERTY.timezone),
    now: EARLY_IN_OCTOBER,
    onMonthChanged,
  },
}
export default meta
type Story = StoryObj<typeof GoalBulkTable>

type Canvas = ReturnType<typeof within>

const targetOf = (canvas: Canvas, name: string) =>
  canvas.getByRole('spinbutton', { name: `Monthly target for ${name}` })
/** The row that starts with `name`: a row's name is its cells, the Portal's first. */
const rowOf = (canvas: Canvas, name: string) =>
  within(canvas.getByRole('row', { name: (rowName: string) => rowName.startsWith(name) }))
const saveGoals = (canvas: Canvas) =>
  userEvent.click(canvas.getByRole('button', { name: 'Save goals' }))
/** The two open rows of the default table, filled: 12 for the Bar, 30 for the first floor. */
async function fillBarAndFloor(canvas: Canvas, floor = '30') {
  await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
  await userEvent.type(targetOf(canvas, FLOOR_FIELD), floor)
}
/** No row takes a number: the table says so, and there is no button to press in vain. */
async function expectNothingLeftToSave(canvas: Canvas) {
  expect(canvas.queryAllByRole('spinbutton')).toHaveLength(0)
  expect(canvas.queryByRole('button', { name: 'Save goals' })).toBeNull()
  await expect(
    canvas.getByText('Every portal and group has a goal for this measure.'),
  ).toBeVisible()
}

/** Picks a measure from the select above the table. */
async function chooseMeasure(canvas: Canvas, label: string) {
  const select = canvas.getByRole('combobox', { name: 'Metric' })
  await userEvent.click(select)
  const content = select.ownerDocument.getElementById(
    select.getAttribute('aria-controls') ?? '',
  )
  if (!content) throw new Error('The measure select did not open')
  await userEvent.click(within(content).getByRole('option', { name: label }))
  await waitFor(() => expect(select).toHaveTextContent(label))
}

/**
 * Three rows by name, the archived Portal left out. The Lobby already has a
 * goal for the measure, so its row takes no number; the two filled rows become
 * a goal each and say so.
 */
export const SetsAGoalPerFilledRow: Story = {
  play: async ({ canvasElement }) => {
    savesAll.mockClear()
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Set goals for several portals' }),
    ).toBeVisible()
    await expect(
      canvas.getByText('One number per portal. Each becomes its own goal.'),
    ).toBeVisible()
    await expect(
      within(canvas.getByRole('group', { name: 'When do these goals start?' })).getByRole(
        'radio',
        { name: 'This month — counts everything since Oct 1' },
      ),
    ).toBeChecked()

    expect(canvas.getAllByRole('spinbutton').map((field) => field.id)).toEqual([
      `goal-target-portal-${BAR_ID}`,
      `goal-target-portal_group-${FLOOR_ID}`,
    ])
    expect(canvas.queryByText('Old spa desk')).toBeNull()
    const lobby = rowOf(canvas, 'Lobby QR')
    await expect(lobby.getByText('400')).toBeVisible()
    await expect(lobby.getByText('Already has a goal')).toBeVisible()
    await expect(
      lobby.getByText(
        'Lobby QR is part of Lobby ratings. Remove it from that goal’s subjects, then start the new goal next month.',
      ),
    ).toBeVisible()
    expect(lobby.getByRole('link', { name: 'Lobby ratings' })).toHaveAttribute(
      'href',
      `/properties/${BULK_PROPERTY.id}/goals/${LOBBY_RATINGS.program.id}`,
    )
    // Nothing has been saved yet, and the region that will say so is already there.
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()

    await fillBarAndFloor(canvas)
    // Nothing has been saved, so there is no way on beside the button yet.
    expect(canvas.queryByRole('link', { name: 'Back to goals' })).toBeNull()
    await saveGoals(canvas)

    await waitFor(() => expect(savesAll).toHaveBeenCalledOnce())
    expect(savesAll.mock.calls[0]?.[0].data).toEqual({
      propertyId: BULK_PROPERTY.id,
      metric: 'portal_rating_count',
      startMonth: '2026-10',
      items: [
        { subject: BAR, targetValue: 12 },
        { subject: FLOOR, targetValue: 30 },
      ],
    })
    await expect(canvas.getByRole('status')).toHaveTextContent('2 goals saved.')
    const bar = rowOf(canvas, 'Bar QR')
    await expect(bar.getByText('Goal saved')).toBeVisible()
    await expect(bar.getByText('12')).toBeVisible()
    expect(bar.getByRole('link', { name: 'View goal' })).toHaveAttribute(
      'href',
      `/properties/${BULK_PROPERTY.id}/goals/program-new-1`,
    )
    await expect(rowOf(canvas, 'First floor').getByText('Goal saved')).toBeVisible()
    // Every row has its goal: none takes a number any more, so there is
    // nothing to save. The button that was pressed is gone, and the focus goes
    // to the way on instead of falling to the top of the page.
    await expectNothingLeftToSave(canvas)
    const back = canvas.getByRole('link', { name: 'Back to goals' })
    expect(back).toHaveAttribute('href', `/properties/${BULK_PROPERTY.id}/goals`)
    await waitFor(() => expect(back).toHaveFocus())
  },
}

/**
 * Enter in a row saves, like the button. The field the person was in is gone
 * once its row has a goal, so the focus goes to that row's goal: it stays in
 * the table, where the result is.
 */
export const SavingWithEnterKeepsTheFocusInTheRow: Story = {
  play: async ({ canvasElement }) => {
    savesAll.mockClear()
    const canvas = within(canvasElement)
    await fillBarAndFloor(canvas, '30{Enter}')

    await expect(await canvas.findByText('2 goals saved.')).toBeVisible()
    expect(savesAll).toHaveBeenCalledOnce()
    const floorGoal = rowOf(canvas, 'First floor').getByRole('link', {
      name: 'View goal',
    })
    await waitFor(() => expect(floorGoal).toHaveFocus())
  },
}

/**
 * A number belongs to the measure it was typed for: 12 private ratings is not
 * 12 scans. Another measure starts with empty rows, so a save there sends only
 * what was typed there.
 */
export const ANumberStaysWithItsMeasure: Story = {
  play: async ({ canvasElement }) => {
    savesAll.mockClear()
    const canvas = within(canvasElement)
    await fillBarAndFloor(canvas)
    await saveGoals(canvas)
    await expect(await canvas.findByText('2 goals saved.')).toBeVisible()

    await chooseMeasure(canvas, 'Qualified scans')

    // No goal for scans yet: every row is open, and none carries a number over.
    const fields = canvas.getAllByRole('spinbutton')
    expect(fields).toHaveLength(3)
    for (const field of fields) await expect(field).toHaveValue(null)
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()

    await saveGoals(canvas)
    await expect(
      await canvas.findByText('Enter a target for at least one portal.'),
    ).toBeVisible()
    expect(savesAll).toHaveBeenCalledOnce()

    await userEvent.type(targetOf(canvas, 'Lobby QR'), '900')
    await saveGoals(canvas)
    await waitFor(() => expect(savesAll).toHaveBeenCalledTimes(2))
    expect(savesAll.mock.calls[1]?.[0].data).toEqual({
      propertyId: BULK_PROPERTY.id,
      metric: 'qualified_scans',
      startMonth: '2026-10',
      items: [{ subject: LOBBY, targetValue: 900 }],
    })
    await expect(await canvas.findByText('1 goal saved.')).toBeVisible()
    // The Bar and the first floor got no scans goal: their rows are still open
    // and empty, and the way back to the list is beside the button.
    await expect(targetOf(canvas, 'Bar QR')).toHaveValue(null)
    await expect(targetOf(canvas, FLOOR_FIELD)).toHaveValue(null)
    await expect(canvas.getByRole('link', { name: 'Back to goals' })).toBeVisible()

    // What was saved for private ratings is still what that table says.
    await chooseMeasure(canvas, 'Private rating count')
    await expect(rowOf(canvas, 'Bar QR').getByText('Goal saved')).toBeVisible()
    await expect(rowOf(canvas, 'Bar QR').getByText('12')).toBeVisible()
  },
}

/**
 * One row is refused. The other is saved, the live region says both, the focus
 * goes to the refused row, and it stays open: saving again sends it alone.
 */
export const ARefusedRowStaysOpen: Story = {
  args: { createGoalsForSubjectsFn: asSave(refusesTheGroup) },
  play: async ({ canvasElement }) => {
    refusesTheGroup.mockClear()
    const canvas = within(canvasElement)
    await fillBarAndFloor(canvas)
    await saveGoals(canvas)

    await expect(await canvas.findByText('1 goal saved. 1 not saved.')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent(
      '1 goal saved. 1 not saved.',
    )
    await expect(rowOf(canvas, 'Bar QR').getByText('Goal saved')).toBeVisible()
    const floor = rowOf(canvas, 'First floor')
    await expect(floor.getByText('Already has a goal')).toBeVisible()
    await waitFor(() => expect(targetOf(canvas, FLOOR_FIELD)).toHaveFocus())
    await expect(targetOf(canvas, FLOOR_FIELD)).toHaveValue(30)
    // A row is still without its goal, so the table does not point the way out.
    expect(canvas.queryByRole('link', { name: 'Back to goals' })).toBeNull()

    // The saved row is not sent a second time.
    await saveGoals(canvas)
    await waitFor(() => expect(refusesTheGroup).toHaveBeenCalledTimes(2))
    expect(refusesTheGroup.mock.calls[1]?.[0].data.items).toEqual([
      { subject: FLOOR, targetValue: 30 },
    ])
    await expect(await canvas.findByText('No goals saved. 1 not saved.')).toBeVisible()
    await expect(rowOf(canvas, 'Bar QR').getByText('Goal saved')).toBeVisible()
  },
}

/**
 * A rating average is from 1 to 5. A number outside it is said on its row and
 * nothing is sent until it is put right.
 */
export const TheAverageMeasureShowsThe1To5Message: Story = {
  play: async ({ canvasElement }) => {
    savesAll.mockClear()
    const canvas = within(canvasElement)
    await chooseMeasure(canvas, 'Private rating average')
    // The Lobby's goal is for another measure, so its row is open now.
    const lobby = targetOf(canvas, 'Lobby QR')
    await expect(lobby).toHaveAttribute('max', '5')
    await expect(lobby).toHaveAttribute('step', '0.1')

    await userEvent.type(lobby, '7')
    await userEvent.type(targetOf(canvas, 'Bar QR'), '4.5')
    await saveGoals(canvas)

    await expect(
      await rowOf(canvas, 'Lobby QR').findByText('Use a rating target from 1 to 5'),
    ).toBeVisible()
    expect(savesAll).not.toHaveBeenCalled()
    await expect(lobby).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(lobby).toHaveFocus())
    await expect(targetOf(canvas, 'Bar QR')).toHaveAttribute('aria-invalid', 'false')

    // The message was about that number: it leaves as the number changes.
    await userEvent.clear(lobby)
    await userEvent.type(lobby, '4.2')
    expect(canvas.queryByText('Use a rating target from 1 to 5')).toBeNull()
    await saveGoals(canvas)

    await waitFor(() => expect(savesAll).toHaveBeenCalledOnce())
    expect(savesAll.mock.calls[0]?.[0].data).toMatchObject({
      metric: 'portal_rating_average',
      items: [
        { subject: BAR, targetValue: 4.5 },
        { subject: LOBBY, targetValue: 4.2 },
      ],
    })
    await expect(canvas.getByRole('status')).toHaveTextContent('2 goals saved.')
  },
}

/**
 * A goal ended this month keeps its subject until the month is over: the row is
 * taken for goals that start now and free for goals that start next month.
 */
export const HeldByAnEndedGoalUntilItsMonthEnds: Story = {
  args: { programs: [LOBBY_RATINGS_ENDED] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const lobby = rowOf(canvas, 'Lobby QR')
    await expect(lobby.getByText('Already has a goal')).toBeVisible()
    await expect(
      lobby.getByText(
        'Lobby QR has a goal for this measure that ends Oct 31. Start the new goal next month.',
      ),
    ).toBeVisible()
    expect(lobby.queryByRole('spinbutton')).toBeNull()

    await userEvent.click(
      canvas.getByRole('radio', { name: 'Next month — starts Nov 1' }),
    )

    await expect(targetOf(canvas, 'Lobby QR')).toBeVisible()
    expect(rowOf(canvas, 'Lobby QR').queryByText('Already has a goal')).toBeNull()
  },
}

/** A save with no number in it is not sent; the banner above the button says why. */
export const NothingToSave: Story = {
  play: async ({ canvasElement }) => {
    savesAll.mockClear()
    const canvas = within(canvasElement)
    await saveGoals(canvas)

    await expect(
      await canvas.findByText('Enter a target for at least one portal.'),
    ).toBeVisible()
    expect(savesAll).not.toHaveBeenCalled()
  },
}

/**
 * The form was left open across the end of the month. The command refuses the
 * whole save, the form says so, and the page reads the two months again.
 */
export const TheMonthHasChanged: Story = {
  args: { createGoalsForSubjectsFn: asSave(monthHasChanged) },
  play: async ({ canvasElement }) => {
    monthHasChanged.mockClear()
    onMonthChanged.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await saveGoals(canvas)

    await expect(
      await canvas.findByText('The month has changed. Check the start and save again.'),
    ).toBeVisible()
    expect(onMonthChanged).toHaveBeenCalledOnce()
    // Nothing was saved, so nothing is said to have been; the number is kept.
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()
    await expect(targetOf(canvas, 'Bar QR')).toHaveValue(12)
  },
}

/**
 * The command refuses the whole save with a code, and sends the code as its
 * message. The banner says a sentence: here the Property was removed while the
 * table was open. Nothing was written, so the goals are not read again.
 */
export const ASaveRefusedAsAWholeSaysASentence: Story = {
  args: { createGoalsForSubjectsFn: asSave(propertyIsGone) },
  play: async ({ canvasElement }) => {
    propertyIsGone.mockClear()
    readAgain.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await saveGoals(canvas)

    const banner = await canvas.findByRole('alert')
    await expect(banner).toHaveTextContent('This property can’t be found.')
    expect(banner.textContent).not.toMatch(/_/u)
    expect(readAgain).not.toHaveBeenCalled()
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()
    await expect(targetOf(canvas, 'Bar QR')).toHaveValue(12)
  },
}

/**
 * Each row is saved on its own, so a save that is lost on the way may have
 * left goals behind. The table asks for the goals again, and a row that got
 * its goal is then drawn as taken before the person saves a second time.
 */
export const ASaveLostOnTheWayReadsTheGoalsAgain: Story = {
  args: { createGoalsForSubjectsFn: asSave(failsOnTheWay) },
  play: async ({ canvasElement }) => {
    failsOnTheWay.mockClear()
    readAgain.mockClear()
    const canvas = within(canvasElement)
    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await saveGoals(canvas)

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Try again.',
    )
    expect(readAgain).toHaveBeenCalledOnce()
    await expect(targetOf(canvas, 'Bar QR')).toHaveValue(12)
  },
}

/**
 * The answer of a save is about the table it was sent from, so the measure and
 * the start cannot be changed until it is here.
 */
export const TheMeasureAndStartWaitForASave: Story = {
  args: { createGoalsForSubjectsFn: asSave(savesWhenReleased) },
  play: async ({ canvasElement }) => {
    savesWhenReleased.mockClear()
    const canvas = within(canvasElement)
    const measure = canvas.getByRole('combobox', { name: 'Metric' })
    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await saveGoals(canvas)

    await waitFor(() => expect(measure).toBeDisabled())
    for (const month of canvas.getAllByRole('radio')) expect(month).toBeDisabled()

    held.release()
    await expect(await canvas.findByText('1 goal saved.')).toBeVisible()
    await waitFor(() => expect(measure).toBeEnabled())
    for (const month of canvas.getAllByRole('radio')) expect(month).toBeEnabled()
  },
}

/** The usual return visit: every row has its goal, so there is nothing to save. */
export const EveryRowHasItsGoal: Story = {
  args: { programs: [LOBBY_RATINGS, BAR_RATINGS, FLOOR_RATINGS] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectNothingLeftToSave(canvas)
    await expect(canvas.getByRole('link', { name: 'Back to goals' })).toBeVisible()
  },
}

/** One Portal and no group: there is nothing to set several goals for. */
export const OnePortal: Story = {
  args: { groups: [], portals: [BULK_PORTALS[0], BULK_PORTALS[2]] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('This property has one portal')).toBeVisible()
    await expect(canvas.getByText('Set its goal on the One goal tab.')).toBeVisible()
    expect(canvas.queryByRole('table')).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Save goals' })).toBeNull()
  },
}

/** No row is drawn before the goals are known: a taken row must not look open. */
export const ReadingTheGoals: Story = {
  args: { programs: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Loading portals and goals')).toBeInTheDocument()
    expect(canvas.queryByRole('spinbutton')).toBeNull()
  },
}

export const TheGoalsCouldNotBeRead: Story = {
  args: {
    programs: undefined,
    goalsRead: { failed: true, retrying: false, readAgain },
  },
  play: async ({ canvasElement }) => {
    readAgain.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The goals couldn’t be loaded.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(readAgain).toHaveBeenCalledOnce()
  },
}

export const SetsAGoalPerFilledRowLight: Story = {
  ...SetsAGoalPerFilledRow,
  parameters: { theme: 'light' },
}
