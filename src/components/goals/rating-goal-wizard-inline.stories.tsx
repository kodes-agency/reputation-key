// The Google rating goal wizard at the end of a single-Property Google import:
// the same "Pick a plan" inside the setup frame, on the page (decision 10;
// round 2, R2-6), with "Not now" as every step's way out. The Storybook Vitest project compiles no
// Tailwind, so the plays assert what is on the page and what each button sends.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { RatingGoalWizard, type RatingGoalWizardProps } from './rating-goal-wizard'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
import { setGoalAndLand } from './rating-goal-wizard.stories.play'
import {
  FIXTURE_GOAL_ID,
  FIXTURE_PROPERTY_ID,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

type SetFn = RatingGoalWizardProps['setRatingGoalFn']
type ChangeFn = RatingGoalWizardProps['changeRatingGoalFn']

const meta: Meta<typeof RatingGoalWizard> = {
  title: 'Goals/RatingGoalWizard at import',
  component: RatingGoalWizard,
  parameters: { layout: 'padded' },
  args: {
    inline: true,
    open: true,
    onOpenChange: fn(),
    onSaved: fn(),
    propertyId: FIXTURE_PROPERTY_ID,
    intent: { kind: 'climb' },
    setup: { data: SETUP_BETA, failed: false, retrying: false, retry: () => undefined },
    hasPortals: false,
    setRatingGoalFn: fn<SetFn>(async () => ({ goalId: FIXTURE_GOAL_ID, version: 1 })),
    changeRatingGoalFn: fn<ChangeFn>(async () => ({
      goalId: FIXTURE_GOAL_ID,
      version: 2,
    })),
  },
  render: (args) => (
    <div className="max-w-3xl">
      <RatingGoalWizard {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>

/** On the page, not over it: no dialog, and "Not now" is the way out. */
export const PickAPlan: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(within(document.body).queryByRole('dialog')).toBeNull()
    const step = within(canvas.getByRole('region', { name: 'Google rating goal' }))
    await expect(step.getByRole('heading', { name: 'Pick a plan' })).toBeVisible()
    await expect(step.getByText('Google shows 3.9 from 261 reviews.')).toBeVisible()
    await expect(step.getByRole('radio', { name: /^Recommended 4\.0/ })).toBeChecked()
    await expect(step.queryByRole('button', { name: 'Cancel' })).toBeNull()

    await userEvent.click(step.getByRole('button', { name: 'Not now' }))
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** The plan on the page, then the receipt and its one next step: a first Portal. */
export const SetsAGoal: Story = {
  play: async ({ canvasElement, args }) => {
    const step = within(canvasElement)
    await setGoalAndLand(step)
    await expect(args.setRatingGoalFn).toHaveBeenCalledWith({
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'climb',
        targetTenths: 40,
        qualityTenths: 45,
        paceTenthsPerWeek: 20,
      },
    })
    await expect(args.onSaved).toHaveBeenCalledOnce()
    await expect(step.getByRole('link', { name: 'Create a portal' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals/new`,
    )
    await userEvent.click(step.getByRole('button', { name: 'Go to goals' }))
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** Google shows 5.0, nothing is higher: one step to keep the number, and "Not now". */
export const KeepTheNumber: Story = {
  args: {
    intent: { kind: 'keep', targetTenths: 50 },
    setup: {
      data: SETUP_KEEP_FIRST,
      failed: false,
      retrying: false,
      retry: () => undefined,
    },
  },
  play: async ({ canvasElement }) => {
    const step = within(canvasElement)
    await expect(step.getByRole('heading', { name: 'Keep 5.0 on Google' })).toBeVisible()
    await expect(step.getByRole('button', { name: 'Start watching' })).toBeVisible()
    await expect(step.getByRole('button', { name: 'Not now' })).toBeVisible()
  },
}
