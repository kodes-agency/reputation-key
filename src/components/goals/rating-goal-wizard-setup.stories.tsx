// The one-screen setup under a manager's hands (rounds 3 and 4, E2): − and +
// pin a goal and "Back to 4.1, recommended" lets go; the ends say why they
// stop; a pace typed a month or out of range; an average typed up to 5.0; the
// faster-pace link keeping the goal it named (D31); the two explanations; a
// refusal in plain words. On Harborline Suites (3.9 from 261) unless named.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import {
  aimsFor,
  clearMocks,
  Harness,
  numeral,
  openWizard,
  refusal,
  setMock,
  statusLine,
  type Dialog,
} from './rating-goal-wizard.stories.harness'

const meta: Meta<typeof Harness> = {
  title: 'Goals/RatingGoalWizard/Setup',
  component: Harness,
  args: { intent: { kind: 'climb' } },
  beforeEach: clearMocks,
}

export default meta
type Story = StoryObj<typeof meta>

/** "Your own", then a pace typed and entered; the field it was typed in. */
async function typeOwnPace(dialog: Dialog, typed: string) {
  await userEvent.click(dialog.getByRole('button', { name: 'Your own' }))
  const own = dialog.getByRole('textbox', { name: 'New reviews' })
  await userEvent.clear(own)
  await userEvent.type(own, `${typed}{Enter}`)
  return own
}

export const PinAndBack: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Raise the goal to 4.2' }))
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.2')
    await expect(dialog.getByText('in about 6 months')).toBeVisible()
    await expect(statusLine()).toBe('Back to 4.1, recommended')
    await userEvent.click(
      dialog.getByRole('button', { name: 'Back to 4.1, recommended' }),
    )
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.1')
    await expect(statusLine()).toBe('Recommended · 4.2 possible in about 6 months')
  },
}

export const CapHint: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(numeral(dialog))
    await userEvent.keyboard('{End}')
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.4')
    const raise = dialog.getByRole('button', {
      name: '4.4 is the highest goal at this average',
    })
    await expect(raise).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(raise)
    await expect(statusLine()).toContain(
      '4.5 needs new reviews above 4.5 stars, more than planned',
    )
    // The hint goes with the next change.
    await userEvent.click(dialog.getByRole('button', { name: 'Lower the goal to 4.3' }))
    await expect(statusLine()).not.toContain('more than planned')
  },
}

export const LowHint: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(numeral(dialog))
    await userEvent.keyboard('{Home}')
    await userEvent.click(dialog.getByRole('button', { name: '4.0 is the lowest goal' }))
    await expect(statusLine()).toBe(
      '4.0 is the lowest goal, one step up from 3.9 · Back to 4.1, recommended',
    )
  },
}

export const OwnPaceMonth: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('radio', { name: 'a month' }))
    await expect(dialog.getByText('30 a month')).toBeVisible()
    await expect(await typeOwnPace(dialog, '20')).toHaveValue('20')
    await expect(
      dialog.getByText('new reviews at 20 a month', { exact: false }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Back to options' })).toBeVisible()
    await aimsFor(dialog, 41, 45, 46)
  },
}

export const OwnPaceClamp: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(await typeOwnPace(dialog, '80')).toHaveValue('50')
    await expect(
      dialog.getByText('We plan with up to 50 a day, so we used 50 a day.'),
    ).toBeVisible()
    await expect(dialog.getByRole('slider', { name: 'New reviews' })).toHaveAttribute(
      'aria-valuetext',
      '50 a day',
    )
  },
}

export const OwnAverage: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Change' }))
    const own = dialog.getByRole('textbox', { name: 'New reviews planned at' })
    await userEvent.clear(own)
    await userEvent.type(own, '5.0{Enter}')
    await expect(dialog.getByText('your own number')).toBeVisible()
    await expect(
      dialog.getByText('You set this. We switch to your real average as reviews arrive.'),
    ).toBeVisible()
    await userEvent.click(numeral(dialog))
    await userEvent.keyboard('{End}')
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.9')
    await userEvent.click(dialog.getByRole('button', { name: 'Back to automatic' }))
    await expect(dialog.getByText('your best year, 2024')).toBeVisible()
  },
}

/** Over six months, the faster pace keeps the goal it names (D31). */
export const FasterPaceLink: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Raise the goal to 4.2' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Raise the goal to 4.3' }))
    await expect(dialog.getByText('in about a year')).toBeVisible()
    await userEvent.click(
      dialog.getByRole('button', { name: 'At 2 a day, about 6 months' }),
    )
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.3')
    await expect(dialog.getByText('in about 6 months')).toBeVisible()
    await expect(statusLine()).toBe('Back to 4.2, recommended')
    await expect(dialog.getByRole('slider', { name: 'New reviews' })).toHaveAttribute(
      'aria-valuetext',
      '2 a day',
    )
  },
}

export const PopoversOpenAndClose: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'How we worked this out' }))
    const why = within(
      await within(document.body).findByRole('dialog', { name: 'How we worked out 4.1' }),
    )
    await expect(
      why.getByText('After your first 10 new reviews, their real average takes over.', {
        exact: false,
      }),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        within(document.body).queryByRole('dialog', { name: 'How we worked out 4.1' }),
      ).toBeNull(),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Why every guest' }))
    const ask = within(
      await within(document.body).findByRole('dialog', { name: 'Why ask every guest' }),
    )
    await expect(ask.getByText(PLAN_POLICY_LINE)).toBeVisible()
    await userEvent.click(ask.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(
        within(document.body).queryByRole('dialog', { name: 'Why ask every guest' }),
      ).toBeNull(),
    )
  },
}

export const Refusal: Story = {
  play: async ({ canvasElement }) => {
    setMock.mockRejectedValueOnce(refusal('goal_exists'))
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Aim for 4.1' }))
    await expect(
      await dialog.findByText(
        'This property already has a Google rating goal. Close this to see it on the Goals page.',
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Your Google goal' })).toBeVisible()
  },
}
