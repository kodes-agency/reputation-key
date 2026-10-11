// GoalBulkTable: one number per Portal or Portal Group, one save, one goal per
// filled row. The Storybook Vitest project compiles no Tailwind, so the plays
// pin behaviour and wiring: which rows take a number, what a save sends, what
// each row and the live region say afterwards, where the focus goes, and that a
// row that got no goal can be sent again. Dark is the default theme; the light
// variant draws the same table on the light surface (axe runs on both).
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { GoalBulkTable } from './goal-bulk-table'
import { goalStartChoice } from './goal-start-view'
import {
  BAR_ID,
  BULK_GROUPS,
  BULK_PORTALS,
  BULK_PROPERTY,
  EARLY_IN_OCTOBER,
  FLOOR_ID,
  LOBBY_ID,
  LOBBY_RATINGS,
  LOBBY_RATINGS_ENDED,
} from './goal-bulk.stories.fixtures'

type SaveInput = Parameters<typeof createGoalsForSubjects>[0]
type SaveResult = Awaited<ReturnType<typeof createGoalsForSubjects>>
type Outcome = SaveResult['outcomes'][number]

const BAR = { kind: 'portal', portalId: BAR_ID } as const
const FLOOR = { kind: 'portal_group', portalGroupId: FLOOR_ID } as const

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
const asSave = (mock: unknown) => mock as typeof createGoalsForSubjects

const onMonthChanged = fn()
const onRetry = fn()

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
    goalsRead: { failed: false, retrying: false, onRetry },
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

    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await userEvent.type(targetOf(canvas, 'First floor'), '30')
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
    // Every row has its goal: none takes a number any more.
    expect(canvas.queryAllByRole('spinbutton')).toHaveLength(0)
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
    await userEvent.type(targetOf(canvas, 'Bar QR'), '12')
    await userEvent.type(targetOf(canvas, 'First floor'), '30')
    await saveGoals(canvas)

    await expect(await canvas.findByText('1 goal saved. 1 not saved.')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent(
      '1 goal saved. 1 not saved.',
    )
    await expect(rowOf(canvas, 'Bar QR').getByText('Goal saved')).toBeVisible()
    const floor = rowOf(canvas, 'First floor')
    await expect(floor.getByText('Already has a goal')).toBeVisible()
    await waitFor(() => expect(targetOf(canvas, 'First floor')).toHaveFocus())
    await expect(targetOf(canvas, 'First floor')).toHaveValue(30)

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
        { subject: { kind: 'portal', portalId: LOBBY_ID }, targetValue: 4.2 },
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
  args: { programs: undefined, goalsRead: { failed: true, retrying: false, onRetry } },
  play: async ({ canvasElement }) => {
    onRetry.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The goals couldn’t be loaded.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  },
}

export const SetsAGoalPerFilledRowLight: Story = {
  ...SetsAGoalPerFilledRow,
  parameters: { theme: 'light' },
}
