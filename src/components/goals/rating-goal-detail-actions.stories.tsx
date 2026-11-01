// What the Google rating goal's detail page lets a manager do with an active goal
// (2026-11-01): open the Portals, change the plan, or end the goal, which confirms
// first in the destructive tone and stays open on a refusal to say it. Only a manager
// allowed to change or end a goal sees the buttons. The page itself is
// `rating-goal-detail.stories.tsx`.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withPermissions } from '../../../.storybook/AuthedRouterDecorator'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { RatingGoalDetailActions } from './rating-goal-detail-actions'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import {
  DETAIL,
  FIXTURE_PROPERTY_ID,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const meta: Meta<typeof RatingGoalDetailActions> = {
  title: 'Goals/RatingGoalDetail/Actions',
  component: RatingGoalDetailActions,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof meta>

const onChange = fn()
const onEnd = fn(async () => undefined)

/** A manager sees both actions; ending confirms first, in the destructive tone. */
export const Actions: Story = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
        propertyId={FIXTURE_PROPERTY_ID}
        goal={DETAIL}
        setup={SETUP}
        onChange={onChange}
        onEnd={onEnd}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    onChange.mockClear()
    onEnd.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Open Portals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals`,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Change plan' }))
    await expect(onChange).toHaveBeenCalledOnce()

    await userEvent.click(canvas.getByRole('button', { name: 'End goal' }))
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    await expect(dialog.getByText('End the Google rating goal?')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'End goal' }))
    await waitFor(() => expect(onEnd).toHaveBeenCalledOnce())
  },
}

const refusedEnd = withRatingGoalRefusals(async (_: void): Promise<never> => {
  throw new ServerFunctionError(
    'RatingGoalError',
    'version_conflict',
    'version_conflict',
    409,
  )
})
const endRefused = fn(() => refusedEnd(undefined))

/** Ending refused (another manager changed it first): the confirmation stays and says why. */
export const EndRefused: Story = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
        propertyId={FIXTURE_PROPERTY_ID}
        goal={DETAIL}
        setup={SETUP}
        onChange={fn()}
        onEnd={endRefused}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    endRefused.mockClear()
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'End goal' }))
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    await userEvent.click(dialog.getByRole('button', { name: 'End goal' }))
    await expect(
      await dialog.findByText(
        'This goal changed after you opened this. Close it and open it again to start from the latest.',
      ),
    ).toBeVisible()
    await expect(endRefused).toHaveBeenCalledOnce()
    await expect(dialog.getByRole('button', { name: 'Keep goal' })).toBeEnabled()
  },
}

/** Without goal.update and goal.cancel there is nothing to press. */
export const ActionsHiddenWithoutPermission: Story = {
  decorators: [withPermissions(['goal.read', 'portal.read', 'property.read'])],
  render: () => (
    <div data-testid="actions" className="flex gap-2">
      <RatingGoalDetailActions
        propertyId={FIXTURE_PROPERTY_ID}
        goal={DETAIL}
        setup={SETUP}
        onChange={fn()}
        onEnd={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** A goal to keep changes only to a plan the setup offers: none while Google shows 5.0. */
export const KeepGoalWithNothingHigher: Story = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
        propertyId={FIXTURE_PROPERTY_ID}
        goal={{ ...DETAIL, mode: 'keep', paceTenthsPerWeek: null }}
        setup={SETUP_KEEP_FIRST}
        onChange={fn()}
        onEnd={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /Change|Aim/ })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'End goal' })).toBeVisible()
  },
}
