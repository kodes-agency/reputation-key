// The Monday check-in above the Google rating goal's card (round 5, PLAN-D D-3,
// owner answer Q4, mock D4) in every state it can be in: due on the Monday and
// still on the Wednesday, last week's average from ten reviews, no reviews, a
// pace changed during last week (the count alone), either end of the ladder, a
// refusal, and the cards that carry none (answered, too low, a viewer who
// cannot change the goal). The Storybook Vitest project compiles no Tailwind,
// so the plays assert words, roles and what each button sends.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withPermissions } from '../../../.storybook/AuthedRouterDecorator'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import {
  RatingGoalCardWithRecap,
  type RatingGoalRecapCommands,
} from './rating-goal-recap'
import {
  CARD_RECAP_ANSWERED,
  CARD_RECAP_AVERAGE,
  CARD_RECAP_MONDAY,
  CARD_RECAP_ONE_A_WEEK,
  CARD_RECAP_SPLIT,
  CARD_RECAP_TOO_LOW,
  CARD_RECAP_TOP,
  CARD_RECAP_TWO_A_WEEK,
  CARD_RECAP_WEDNESDAY,
  CARD_RECAP_ZERO,
} from './rating-goal-recap.stories.fixtures'
import {
  FIXTURE_GOAL_ID,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
} from './rating-goal.stories.fixtures'
import { refusal } from './rating-goal-wizard.stories.harness'

const keepMock = fn<RatingGoalRecapCommands['keepPaceFn']>(async ({ data }) => ({
  goalId: data.goalId,
  weekStart: data.weekStart,
}))
const changePaceMock = fn<RatingGoalRecapCommands['changeRatingGoalFn']>(async () => ({
  goalId: FIXTURE_GOAL_ID,
  version: 4,
}))
const answeredMock = fn<RatingGoalRecapCommands['onAnswered']>(async () => undefined)

const meta: Meta<typeof RatingGoalCardWithRecap> = {
  title: 'Goals/RatingGoalRecap',
  component: RatingGoalCardWithRecap,
  parameters: { layout: 'padded' },
  args: {
    card: CARD_RECAP_MONDAY,
    propertyId: FIXTURE_PROPERTY_ID,
    timezone: FIXTURE_TIMEZONE,
    now: new Date(FIXTURE_NOW),
    recap: {
      keepPaceFn: keepMock,
      changeRatingGoalFn: changePaceMock,
      onAnswered: answeredMock,
    },
  },
  decorators: [ToasterDecorator],
  beforeEach: () => {
    // Sonner's store outlives a story; a Toaster that mounts replays what still shows.
    toast.dismiss()
    keepMock.mockClear()
    changePaceMock.mockClear()
    answeredMock.mockClear()
  },
  render: (args) => (
    <div className="max-w-5xl">
      <RatingGoalCardWithRecap {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

const recapOf = (canvas: Canvas) => canvas.getByRole('region', { name: 'Last week' })

/** A labelled region, never a live region around its three buttons. */
async function expectRegion(canvas: Canvas) {
  const region = recapOf(canvas)
  await expect(region).toHaveAttribute('data-slot', 'rating-goal-recap')
  await expect(within(region).queryAllByRole('status')).toEqual([])
  await expect(region.closest('[role="status"]')).toBeNull()
  return within(region)
}

/** Once answered, the focus is on the card's title and a toast says what happened. */
async function expectAnswered(toastText: string) {
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute('id', RATING_GOAL_HEADING_ID),
  )
  const shown = await within(document.body).findByText(toastText)
  // Retried: the toast is in the page before it has faded in.
  await waitFor(() => expect(shown).toBeVisible())
}

const buttonNames = (region: ReturnType<typeof within>) =>
  region.getAllByRole('button').map((button: HTMLElement) => button.textContent)

export const Monday: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const region = await expectRegion(canvas)
    await expect(
      region.getByText('8 new Google reviews, 1 more than planned.'),
    ).toBeVisible()
    await expect(
      region.getByText(
        'Your plan is 1 a day, about 7 a week. Keep it for this week, or change it.',
      ),
    ).toBeVisible()
    await expect(region.getByText('Nothing changes unless you choose.')).toBeVisible()
    await expect(buttonNames(region)).toEqual([
      'Keep 1 a day',
      'Raise to 2 a day',
      'Ease to 3 a week',
    ])
    // The card is still there, under it, with its ruler.
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Google rating goal' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('img', {
        name: 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
      }),
    ).toBeVisible()
  },
}

/** Keep sends the week the check-in looked back on; the page reads the goal again. */
export const Keep: Story = {
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Keep 1 a day' }))

    await waitFor(() => expect(answeredMock).toHaveBeenCalledOnce())
    await expect(keepMock).toHaveBeenCalledWith({
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        goalId: FIXTURE_GOAL_ID,
        weekStart: '2026-10-05',
      },
    })
    await expect(changePaceMock).not.toHaveBeenCalled()
    await expectAnswered('Kept 1 a day for this week.')
  },
}

/** Raise and Ease are changes of pace on the version the card read. */
export const Raise: Story = {
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Raise to 2 a day' }))

    await waitFor(() => expect(answeredMock).toHaveBeenCalledOnce())
    await expect(changePaceMock).toHaveBeenCalledWith({
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        goalId: FIXTURE_GOAL_ID,
        expectedVersion: CARD_RECAP_MONDAY.version,
        paceTenthsPerWeek: 140,
      },
    })
    await expectAnswered('Pace changed to 2 a day. Getting started again for 2 weeks.')
  },
}

export const Wednesday: Story = {
  args: { card: CARD_RECAP_WEDNESDAY },
  play: async ({ canvasElement }) => {
    await expectRegion(within(canvasElement))
  },
}

export const TenReviewsWithAverage: Story = {
  args: { card: CARD_RECAP_AVERAGE },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(
      region.getByText('12 new Google reviews at 4.6★, 5 more than planned.'),
    ).toBeVisible()
  },
}

export const NoReviews: Story = {
  args: { card: CARD_RECAP_ZERO },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(
      region.getByText('No new Google reviews last week. The plan was 7.'),
    ).toBeVisible()
  },
}

export const PaceChangedLastWeek: Story = {
  args: { card: CARD_RECAP_SPLIT },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(region.getByText('8 new Google reviews last week.')).toBeVisible()
    await expect(buttonNames(region)).toEqual([
      'Keep 2 a day',
      'Raise to 3 a day',
      'Ease to 1 a day',
    ])
  },
}

export const AtTheTop: Story = {
  args: { card: CARD_RECAP_TOP },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(buttonNames(region)).toEqual(['Keep 50 a day', 'Ease to 30 a day'])
  },
}

export const OneAWeek: Story = {
  args: { card: CARD_RECAP_ONE_A_WEEK },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(
      region.getByText('Your plan is 1 a week. Keep it for this week, or change it.'),
    ).toBeVisible()
    await expect(buttonNames(region)).toEqual(['Keep 1 a week', 'Raise to 3 a week'])
  },
}

export const TwoAWeek: Story = {
  args: { card: CARD_RECAP_TWO_A_WEEK },
  play: async ({ canvasElement }) => {
    const region = await expectRegion(within(canvasElement))
    await expect(buttonNames(region)).toEqual([
      'Keep 2 a week',
      'Raise to 3 a week',
      'Ease to 1 a week',
    ])
  },
}

/** Another manager changed the plan first: the refusal says so where it was pressed. */
export const RefusedVersionConflict: Story = {
  play: async ({ canvasElement }) => {
    changePaceMock.mockRejectedValueOnce(refusal('version_conflict'))
    const region = await expectRegion(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Ease to 3 a week' }))

    await expect(
      await region.findByText(
        'This goal was changed by someone else. Reload to see the latest.',
      ),
    ).toBeVisible()
    // The check-in has nothing to close: the wizard's sentence is not said here.
    await expect(region.queryByText(/Close it and open it again/u)).toBeNull()
    await expect(answeredMock).not.toHaveBeenCalled()
  },
}

/** Two refusals in a row: the banner says the latest press's, never an older one. */
export const RefusedTwice: Story = {
  play: async ({ canvasElement }) => {
    keepMock.mockRejectedValueOnce(refusal('recap_closed'))
    changePaceMock.mockRejectedValueOnce(refusal('version_conflict'))
    const region = await expectRegion(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Keep 1 a day' }))
    await region.findByText('This week’s check-in has closed. Reload to see the latest.')

    await userEvent.click(region.getByRole('button', { name: 'Ease to 3 a week' }))

    await expect(
      await region.findByText(
        'This goal was changed by someone else. Reload to see the latest.',
      ),
    ).toBeVisible()
    await expect(
      region.queryByText('This week’s check-in has closed. Reload to see the latest.'),
    ).toBeNull()
  },
}

/** The week ended, or the pace changed in another tab, before Keep landed. */
export const RefusedClosed: Story = {
  play: async ({ canvasElement }) => {
    keepMock.mockRejectedValueOnce(refusal('recap_closed'))
    const region = await expectRegion(within(canvasElement))
    await userEvent.click(region.getByRole('button', { name: 'Keep 1 a day' }))

    await expect(
      await region.findByText(
        'This week’s check-in has closed. Reload to see the latest.',
      ),
    ).toBeVisible()
  },
}

const expectNoRecap = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  await expect(canvas.queryByRole('region', { name: 'Last week' })).toBeNull()
  await expect(
    canvas.getByRole('heading', { level: 2, name: 'Google rating goal' }),
  ).toBeVisible()
}

// Answered and TooLow pass cards that carry no check-in: they show the card
// draws none then. Which reads carry one is ruled (and tested) on the server,
// in domain/rating-goal-recap.test.ts.
export const Answered: Story = {
  args: { card: CARD_RECAP_ANSWERED },
  play: async ({ canvasElement }) => expectNoRecap(canvasElement),
}

export const TooLow: Story = {
  args: { card: CARD_RECAP_TOO_LOW },
  play: async ({ canvasElement }) => expectNoRecap(canvasElement),
}

/** A viewer who cannot change the goal sees the card alone. */
export const CannotChange: Story = {
  decorators: [withPermissions(['goal.read', 'portal.read', 'property.read'])],
  play: async ({ canvasElement }) => expectNoRecap(canvasElement),
}

const PHONE = { viewport: { defaultViewport: 'mobileStaff' } } as const

export const Phone: Story = { ...Monday, parameters: PHONE }
export const MondayLight: Story = { ...Monday, parameters: { theme: 'light' } }
export const PhoneLight: Story = { ...Monday, parameters: { ...PHONE, theme: 'light' } }
