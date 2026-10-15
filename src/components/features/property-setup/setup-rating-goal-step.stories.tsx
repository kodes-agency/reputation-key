// The Google import's last step for a single Property, as the setup frame shows
// it: offered once Google's numbers are in (and said so in a status line),
// nothing while they are on their way, "Not now" recorded and answered in one
// sentence that takes the focus, a failed "Not now" that keeps the step, and a
// goal set that ends on "Go to goals". The Storybook Vitest project compiles no
// Tailwind, so the plays assert what is on the page and what each button sends.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { RatingGoalWizardProps } from '#/components/goals/rating-goal-wizard'
import { SETUP_BETA } from '#/components/goals/rating-goal-plan.stories.fixtures'
import {
  FIXTURE_GOAL_ID,
  FIXTURE_PROPERTY_ID,
} from '#/components/goals/rating-goal.stories.fixtures'
import { setGoalAndLand } from '#/components/goals/rating-goal-wizard.stories.play'
import { RATING_GOAL_STEP_APPEARED, SetupRatingGoalStep } from './setup-rating-goal-step'

type SetFn = RatingGoalWizardProps['setRatingGoalFn']
type ChangeFn = RatingGoalWizardProps['changeRatingGoalFn']

const read = (data: typeof SETUP_BETA | undefined) => ({
  data,
  failed: false,
  retrying: false,
  retry: () => undefined,
})

const meta: Meta<typeof SetupRatingGoalStep> = {
  title: 'PropertySetup/SetupRatingGoalStep',
  component: SetupRatingGoalStep,
  parameters: { layout: 'padded' },
  args: {
    propertyId: FIXTURE_PROPERTY_ID,
    setup: read(SETUP_BETA),
    setRatingGoalFn: fn<SetFn>(async () => ({ goalId: FIXTURE_GOAL_ID, version: 1 })),
    changeRatingGoalFn: fn<ChangeFn>(async () => ({
      goalId: FIXTURE_GOAL_ID,
      version: 2,
    })),
    onNotNow: fn(async () => ({ propertyId: FIXTURE_PROPERTY_ID })),
    onGoToGoals: fn(),
  },
  render: (args) => (
    <div className="max-w-3xl">
      <SetupRatingGoalStep {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>

/** The page and the step on it, once it has appeared. */
async function offeredStep(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
  return { canvas, step }
}

/** Presses "Not now" and checks it was recorded once. */
async function pressNotNow(
  step: Awaited<ReturnType<typeof offeredStep>>['step'],
  onNotNow: unknown,
) {
  await userEvent.click(step.getByRole('button', { name: 'Not now' }))
  await expect(onNotNow).toHaveBeenCalledOnce()
}

/** Google's numbers are in: the wizard, on the page, and a status line that says it appeared. */
export const Offered: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, step } = await offeredStep(canvasElement)
    await expect(step.getByRole('heading', { name: 'Pick a plan' })).toBeVisible()
    await expect(step.getByText('Google shows 3.9 from 261 reviews.')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent(RATING_GOAL_STEP_APPEARED)
  },
}

/** Google's numbers are not in yet: nothing on the page, and nothing said. */
export const WaitingForGoogle: Story = {
  args: {
    setup: read({
      ...SETUP_BETA,
      eligibility: { eligible: false, reason: 'waiting_for_google' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'Google rating goal' })).toBeNull()
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()
  },
}

/** "Not now" is recorded, then one sentence takes the step's place and the focus. */
export const NotNow: Story = {
  play: async ({ canvasElement, args }) => {
    const { canvas, step } = await offeredStep(canvasElement)
    await pressNotNow(step, args.onNotNow)
    const sentence = await canvas.findByText(/No Google rating goal for now/)
    await waitFor(() => expect(sentence).toHaveFocus())
    await expect(canvas.getByRole('link', { name: 'Goals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals`,
    )
    await expect(canvas.queryByRole('region', { name: 'Google rating goal' })).toBeNull()
  },
}

/** "Not now" while building a plan of one's own, without closing it first. */
export const NotNowFromBuildYourOwn: Story = {
  play: async ({ canvasElement, args }) => {
    const { canvas, step } = await offeredStep(canvasElement)
    await userEvent.click(step.getByRole('button', { name: 'Build your own' }))
    await expect(step.getByRole('radiogroup', { name: 'Goal on Google' })).toBeVisible()
    await pressNotNow(step, args.onNotNow)
    await expect(
      canvas.findByText(/No Google rating goal for now/),
    ).resolves.toBeVisible()
  },
}

/** "Not now" could not be saved: the step stays, so it can be tried again. */
export const NotNowFails: Story = {
  args: {
    onNotNow: fn(async () => {
      throw new Error('Not saved')
    }),
  },
  play: async ({ canvasElement, args }) => {
    const { canvas, step } = await offeredStep(canvasElement)
    await pressNotNow(step, args.onNotNow)
    await expect(step.getByRole('heading', { name: 'Pick a plan' })).toBeVisible()
    await expect(canvas.queryByText(/No Google rating goal for now/)).toBeNull()
  },
}

/** A goal set at the import ends on "Go to goals", which goes on to the Goals page. */
export const SetThenGoToGoals: Story = {
  play: async ({ canvasElement, args }) => {
    const { canvas, step } = await offeredStep(canvasElement)
    await setGoalAndLand(step)
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()

    await userEvent.click(step.getByRole('button', { name: 'Go to goals' }))
    await expect(args.onGoToGoals).toHaveBeenCalledOnce()
    await expect(args.onNotNow).not.toHaveBeenCalled()
  },
}
