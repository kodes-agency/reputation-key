// The Google rating goal wizard around the one screen: Change plan opening on
// the goal's own plan and sending only what differs (the plan's earlier
// average kept, D30), a change refused because the goal moved, keeping a 5.0,
// the setup still reading or failed, what was picked surviving a phone turned
// to landscape, and the focus going back to what opened the wizard.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  changeMock,
  clearMocks,
  Harness,
  numeral,
  openWizard,
  read,
  refusal,
  setMock,
} from './rating-goal-wizard.stories.harness'
import {
  CARD,
  FIXTURE_PROPERTY_ID,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const meta: Meta<typeof Harness> = {
  title: 'Goals/RatingGoalWizard/Change and frames',
  component: Harness,
  args: { intent: { kind: 'climb' } },
  beforeEach: clearMocks,
}

export default meta
type Story = StoryObj<typeof meta>

/** The goal's own plan: 4.5 at 4.7★ and 11 a week (1.6 a day, a pace of its own). */
export const ChangePlanPrefilled: Story = {
  args: { intent: { kind: 'change', goal: CARD }, setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(numeral(dialog)).toHaveAttribute('aria-valuenow', '4.5')
    await expect(dialog.getByRole('textbox', { name: 'New reviews' })).toHaveValue('1.6')
    await expect(dialog.getByRole('slider', { name: 'New reviews' })).toHaveAttribute(
      'aria-valuetext',
      '1.6 a day',
    )
    const save = dialog.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()
    await expect(save).toHaveAccessibleDescription('Change the plan to save.')
    await userEvent.click(dialog.getByRole('button', { name: 'Back to options' }))
    await expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          goalId: CARD.goalId,
          expectedVersion: CARD.version,
          paceTenthsPerWeek: 140,
        },
      }),
    )
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

/** A stored average that is not today's automatic one stays, as the plan's (D30). */
export const ChangeKeepsThePlansAverage: Story = {
  args: {
    intent: { kind: 'change', goal: { ...CARD, qualityTenths: 48 } },
    setup: read(SETUP),
  },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(dialog.getByText('your plan’s average')).toBeVisible()
    await expect(
      dialog.getByText(
        'Kept from your plan. We switch to your real average as reviews arrive.',
      ),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Back to automatic' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith({
        data: expect.objectContaining({ qualityTenths: 47 }),
      }),
    )
  },
}

export const ChangeAfterAnotherChange: Story = {
  args: { intent: { kind: 'change', goal: CARD }, setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    changeMock.mockRejectedValueOnce(refusal('version_conflict'))
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Back to options' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    await expect(
      await dialog.findByText(
        'This goal changed after you opened this. Close it and open it again to start from the latest.',
      ),
    ).toBeVisible()
  },
}

/** Google shows 5.0 and there is nothing higher: one step, to keep it. */
export const KeepFirst: Story = {
  args: { intent: { kind: 'keep', targetTenths: 50 }, setup: read(SETUP_KEEP_FIRST) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement, 'Keep 5.0 on Google')
    await expect(
      dialog.getByText('We’ll watch that Google keeps showing 5.0.'),
    ).toBeVisible()
    await expect(dialog.queryByRole('spinbutton')).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'keep',
          targetTenths: 50,
          qualityTenths: null,
          paceTenthsPerWeek: null,
        },
      }),
    )
    await expect(await dialog.findByText('Keeping 5.0 on Google')).toBeVisible()
    await expect(dialog.getByText('You can end it at any time.')).toBeVisible()
  },
}

export const SetupStillReading: Story = {
  args: { setup: read(undefined) },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(dialog.queryByRole('spinbutton')).toBeNull()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const SetupFailed: Story = {
  args: { setup: { data: undefined, failed: true, retrying: false, retry: fn() } },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await expect(
      dialog.getByText('Google’s numbers for this property couldn’t be loaded.'),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/**
 * Puts the page in the phone layout or out of it, as turning a phone across
 * 768 px does, until the returned undo runs. The frame asks `matchMedia` and
 * listens for `resize`; nothing else on the page is answered differently.
 */
function turnPhone(phone: boolean): () => void {
  const real = window.matchMedia
  window.matchMedia = (query: string) =>
    query.includes('max-width: 767px')
      ? ({
          matches: phone,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        } satisfies MediaQueryList)
      : real.call(window, query)
  window.dispatchEvent(new Event('resize'))
  return () => {
    window.matchMedia = real
    window.dispatchEvent(new Event('resize'))
  }
}

/** The dialog gives way to the full-screen sheet mid-pick: the pin and the unit stay. */
export const KeepsWhatWasPickedAcrossTheFrames: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const dialog = await openWizard(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Raise the goal to 4.2' }))
    await userEvent.click(dialog.getByRole('radio', { name: 'a month' }))
    const undo = turnPhone(true)
    try {
      await waitFor(() =>
        expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
          'data-wizard-frame',
          'sheet',
        ),
      )
      const sheet = within(await within(document.body).findByRole('dialog'))
      await expect(numeral(sheet)).toHaveAttribute('aria-valuenow', '4.2')
      await expect(sheet.getByRole('radio', { name: 'a month' })).toBeChecked()
      await expect(
        sheet.getByRole('button', { name: 'Back to 4.1, recommended' }),
      ).toBeVisible()
    } finally {
      undo()
    }
  },
}

/** No trigger opened it, so the wizard hands the focus back to what did. */
export const FocusGoesBackOnClose: Story = {
  play: async ({ canvasElement }) => {
    await openWizard(canvasElement)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'Open the wizard' }),
      ).toHaveFocus(),
    )
  },
}
