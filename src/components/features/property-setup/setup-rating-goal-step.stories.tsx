// The Google import's last step for a single Property, as the setup frame shows
// it: offered once Google's numbers are in (and said so in a status line),
// nothing while they are on their way, "Not now" recorded and answered in one
// sentence that takes the focus, a failed "Not now" that keeps the step, and a
// goal set that ends on "Go to goals". The Storybook Vitest project compiles no
// Tailwind, so the plays assert what is on the page and what each button sends.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { RatingGoalWizardProps } from '#/components/goals/rating-goal-wizard'
import {
  FIXTURE_GOAL_ID,
  FIXTURE_PROPERTY_ID,
  SETUP,
} from '#/components/goals/rating-goal.stories.fixtures'
import { RATING_GOAL_STEP_APPEARED, SetupRatingGoalStep } from './setup-rating-goal-step'

type SetFn = RatingGoalWizardProps['setRatingGoalFn']
type ChangeFn = RatingGoalWizardProps['changeRatingGoalFn']

const read = (data: typeof SETUP | undefined) => ({
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
    setup: read(SETUP),
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

/** Google's numbers are in: the wizard, on the page, and a status line that says it appeared. */
export const Offered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
    await expect(step.getByRole('heading', { name: 'Pick your goal' })).toBeVisible()
    await expect(step.getByText('The number you want Google to show.')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent(RATING_GOAL_STEP_APPEARED)
  },
}

/** Google's numbers are not in yet: nothing on the page, and nothing said. */
export const WaitingForGoogle: Story = {
  args: {
    setup: read({
      ...SETUP,
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
    const canvas = within(canvasElement)
    const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
    await userEvent.click(step.getByRole('button', { name: 'Not now' }))

    await expect(args.onNotNow).toHaveBeenCalledOnce()
    const sentence = await canvas.findByText(/No Google rating goal for now/)
    await waitFor(() => expect(sentence).toHaveFocus())
    await expect(canvas.getByRole('link', { name: 'Goals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals`,
    )
    await expect(canvas.queryByRole('region', { name: 'Google rating goal' })).toBeNull()
  },
}

/** "Not now" from the pace step, without going back first. */
export const NotNowFromThePace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
    await userEvent.click(step.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(step.getByRole('heading', { name: 'Pick your pace' })).toHaveFocus(),
    )
    await expect(
      step.getByText('How many new Google reviews a week you aim for.'),
    ).toBeVisible()
    await userEvent.click(step.getByRole('button', { name: 'Not now' }))

    await expect(args.onNotNow).toHaveBeenCalledOnce()
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
    const canvas = within(canvasElement)
    const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
    await userEvent.click(step.getByRole('button', { name: 'Not now' }))

    await expect(args.onNotNow).toHaveBeenCalledOnce()
    await expect(step.getByRole('heading', { name: 'Pick your goal' })).toBeVisible()
    await expect(canvas.queryByText(/No Google rating goal for now/)).toBeNull()
  },
}

/** A goal set at the import ends on "Go to goals", which goes on to the Goals page. */
export const SetThenGoToGoals: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const step = within(await canvas.findByRole('region', { name: 'Google rating goal' }))
    await userEvent.click(step.getByRole('button', { name: 'Next' }))
    await userEvent.click(await step.findByRole('button', { name: 'Set goal' }))
    await waitFor(() =>
      expect(step.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
    )
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement()

    await userEvent.click(step.getByRole('button', { name: 'Go to goals' }))
    await expect(args.onGoToGoals).toHaveBeenCalledOnce()
    await expect(args.onNotNow).not.toHaveBeenCalled()
  },
}
