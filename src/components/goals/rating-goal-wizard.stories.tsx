// The Google rating goal wizard, step by step, on a desktop (a dialog) and a
// phone (a full-screen sheet). The Storybook Vitest project compiles no
// Tailwind, so nothing here claims a pixel; the plays prove what a screenshot
// cannot: the slider moves by tenths from the keyboard, 5.0 is on the scale and
// never chosen, an out-of-reach stop warns, a pace typed in is held to 1-200 and
// cautions above twice the pace now, what is saved, the done screen's one next
// step, a refusal in plain words, and a change that sends only what differs.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from '#/components/ui/button'
import { RatingGoalWizard, type RatingGoalWizardProps } from './rating-goal-wizard'
import type { RatingGoalWizardIntent } from './rating-goal-wizard-view'
import {
  CARD,
  FIXTURE_GOAL_ID,
  FIXTURE_PROPERTY_ID,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

type SetFn = RatingGoalWizardProps['setRatingGoalFn']
type ChangeFn = RatingGoalWizardProps['changeRatingGoalFn']

const setMock = fn<SetFn>(async () => ({ goalId: FIXTURE_GOAL_ID, version: 1 }))
const changeMock = fn<ChangeFn>(async () => ({ goalId: FIXTURE_GOAL_ID, version: 4 }))

const refusal = (code: string) =>
  new ServerFunctionError('RatingGoalError', code, code, 409)

/** A page with the one door the wizard opens from; a fresh wizard for every opening. */
function Harness(
  props: Partial<RatingGoalWizardProps> & Readonly<{ intent: RatingGoalWizardIntent }>,
) {
  const [opening, setOpening] = useState({ open: false, key: 0 })
  return (
    <>
      <Button onClick={() => setOpening(({ key }) => ({ open: true, key: key + 1 }))}>
        Open the wizard
      </Button>
      <RatingGoalWizard
        key={opening.key}
        open={opening.open}
        onOpenChange={(open) => setOpening((current) => ({ ...current, open }))}
        propertyId={FIXTURE_PROPERTY_ID}
        setup={{ data: SETUP, failed: false, retrying: false, retry: () => undefined }}
        hasPortals
        setRatingGoalFn={setMock}
        changeRatingGoalFn={changeMock}
        {...props}
      />
    </>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Goals/RatingGoalWizard',
  component: Harness,
  args: { intent: { kind: 'climb' } },
  beforeEach: () => {
    setMock.mockClear()
    changeMock.mockClear()
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Opens the wizard and waits for its first step's title. */
async function open(canvasElement: HTMLElement, title = 'Pick your goal') {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open the wizard' }),
  )
  const dialog = within(await within(document.body).findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('heading', { name: title })).toBeVisible())
  return dialog
}

type Dialog = Awaited<ReturnType<typeof open>>

async function toPace(dialog: Dialog) {
  await userEvent.click(dialog.getByRole('button', { name: 'Next' }))
  await waitFor(() =>
    expect(dialog.getByRole('heading', { name: 'Pick your pace' })).toHaveFocus(),
  )
}

export const PickYourGoal: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.getByText('Google shows 4.3 from 812 reviews')).toBeVisible()
    const slider = dialog.getByRole('slider', { name: 'Goal on Google' })
    await expect(slider).toHaveAttribute(
      'aria-valuetext',
      '4.4, realistic, about 93 more reviews',
    )
    await expect(dialog.getByText('Realistic')).toBeVisible()
    await expect(dialog.getByText('About 93 more reviews')).toBeVisible()

    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(slider).toHaveAttribute(
      'aria-valuetext',
      '4.5, stretch, about 455 more reviews',
    )
    await expect(dialog.getByText('Stretch')).toBeVisible()
    await expect(dialog.queryByRole('alert')).toBeNull()
  },
}

/** 5.0 is shown and never chosen: the thumb stops at 4.9, and the reason is on the page. */
export const PerfectStopIsDisabled: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const slider = dialog.getByRole('slider', { name: 'Goal on Google' })
    await expect(slider).toHaveAttribute('aria-valuemax', '49')
    await expect(
      dialog.getByText('5.0 needs every review from now on to be 5★'),
    ).toBeVisible()

    slider.focus()
    await userEvent.keyboard('{End}')
    await expect(slider).toHaveAttribute('aria-valuenow', '49')
    await userEvent.keyboard('{ArrowRight}')
    await expect(slider).toHaveAttribute('aria-valuenow', '49')
  },
}

/** An out-of-reach stop can be picked, and says so clearly. */
export const OutOfReachWarns: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const slider = dialog.getByRole('slider', { name: 'Goal on Google' })
    slider.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Out of reach: even at 11 new reviews a week this takes more than a year. You can still pick it.',
    )
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(dialog.getByText('Not reachable at your recent 4.7★ mix')).toBeVisible()
    await expect(dialog.getByRole('alert')).toHaveTextContent(
      'at your recent 4.7★ mix no pace gets Google to show 4.8',
    )
    await expect(dialog.getByRole('button', { name: 'Next' })).toBeEnabled()
  },
}

export const HowWeWorkItOut: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const disclosure = dialog.getByRole('button', { name: 'How we work this out' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(dialog.queryByText(/We start from Google’s own rating/)).toBeNull()
    await userEvent.click(disclosure)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    await expect(
      dialog.getByText('Google shows 4.4 once the exact average reaches 4.35.'),
    ).toBeVisible()
  },
}

export const PickYourPace: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await expect(dialog.getByText('You get about 7 a week now')).toBeVisible()
    const faster = dialog.getByRole('radio', { name: /^Faster/ })
    await expect(faster).toBeChecked()
    // Per month and per day only on the chosen card.
    await expect(dialog.getByText('48 a month · 1.6 a day')).toBeVisible()
    await expect(dialog.queryByText('61 a month · 2 a day')).toBeNull()
    await expect(
      dialog.getByText('Around Nov 2026 – Jan 2027', { exact: false }),
    ).toBeVisible()

    // Radix checks the radio that takes the focus only while the arrow is held.
    faster.focus()
    const push = dialog.getByRole('radio', { name: /^Push/ })
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(push).toHaveFocus())
    await userEvent.keyboard('{/ArrowRight}')
    await expect(push).toBeChecked()
    await expect(dialog.getByText('61 a month · 2 a day')).toBeVisible()
    await expect(dialog.queryByText('48 a month · 1.6 a day')).toBeNull()
  },
}

/** A pace of one's own is a whole number from 1 to 200, with a caution above twice the pace now. */
export const CustomPaceBounds: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('radio', { name: 'Or type your own number' }))
    const field = dialog.getByRole('spinbutton', { name: 'New reviews a week' })
    await expect(field).toHaveValue(11)
    const save = dialog.getByRole('button', { name: 'Set goal' })

    for (const wrong of ['0', '201']) {
      await userEvent.clear(field)
      await userEvent.type(field, wrong)
      await expect(dialog.getByText('Enter a whole number from 1 to 200.')).toBeVisible()
      await expect(save).toBeDisabled()
    }

    await userEvent.clear(field)
    await userEvent.type(field, '30')
    await expect(save).toBeEnabled()
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'That is more than twice the pace you get now.',
    )
    await userEvent.clear(field)
    await userEvent.type(field, '12')
    await expect(dialog.queryByRole('alert')).toBeNull()
  },
}

export const SetsTheGoal: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'climb',
          targetTenths: 44,
          pacePerWeek: 11,
        },
      }),
    )
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
    )
    await expect(dialog.getByText('4.4 on Google')).toBeVisible()
    await expect(dialog.getByText('About 11 new reviews a week')).toBeVisible()
    await expect(dialog.getByText('Expected around Nov 2026 – Jan 2027')).toBeVisible()
    // One next step, and the way back to the Goals page.
    await expect(dialog.getByRole('link', { name: 'Set portal goals' })).toBeVisible()
    await expect(dialog.queryByRole('link', { name: 'Create a portal' })).toBeNull()
    await expect(dialog.getByRole('button', { name: 'Go to goals' })).toBeVisible()
  },
}

export const DoneWithNoPortals: Story = {
  args: { hasPortals: false },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
    await expect(
      await dialog.findByRole('link', { name: 'Create a portal' }),
    ).toBeVisible()
    await expect(dialog.queryByRole('link', { name: 'Set portal goals' })).toBeNull()
  },
}

export const RefusedInPlainWords: Story = {
  play: async ({ canvasElement }) => {
    setMock.mockRejectedValueOnce(refusal('goal_exists'))
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
    await expect(
      await dialog.findByText(
        'This property already has a Google rating goal. Close this to see it on the Goals page.',
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Pick your pace' })).toBeVisible()
  },
}

/** Google shows 5.0 and there is nothing higher: one step, to keep it. */
export const KeepFirst: Story = {
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
    const dialog = await open(canvasElement, 'Keep 5.0 on Google')
    await expect(dialog.getByText('Google shows 5.0 from 19 reviews')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'keep',
          targetTenths: 50,
          pacePerWeek: null,
        },
      }),
    )
    await expect(await dialog.findByText('Keeping 5.0 on Google')).toBeVisible()
  },
}

/** A change opens on the goal's own target and pace and sends only what differs. */
export const ChangeTargetOrPace: Story = {
  args: { intent: { kind: 'change', goal: CARD } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.getByRole('slider', { name: 'Goal on Google' })).toHaveAttribute(
      'aria-valuetext',
      '4.5, stretch, about 455 more reviews',
    )
    await toPace(dialog)
    const save = dialog.getByRole('button', { name: 'Save changes' })
    await expect(dialog.getByRole('radio', { name: /^Faster/ })).toBeChecked()
    await expect(save).toBeDisabled()
    await userEvent.click(dialog.getByRole('radio', { name: /^Push/ }))
    await userEvent.click(save)
    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          goalId: CARD.goalId,
          expectedVersion: CARD.version,
          pacePerWeek: 14,
        },
      }),
    )
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
  },
}

export const ChangeAfterAnotherChange: Story = {
  args: { intent: { kind: 'change', goal: CARD } },
  play: async ({ canvasElement }) => {
    changeMock.mockRejectedValueOnce(refusal('version_conflict'))
    const dialog = await open(canvasElement)
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('radio', { name: /^Push/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    await expect(
      await dialog.findByText(
        'This goal changed after you opened this. Close it and open it again to start from the latest.',
      ),
    ).toBeVisible()
  },
}

export const SetupStillReading: Story = {
  args: {
    setup: { data: undefined, failed: false, retrying: false, retry: () => undefined },
  },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.queryByRole('slider')).toBeNull()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const SetupFailed: Story = {
  args: { setup: { data: undefined, failed: true, retrying: false, retry: fn() } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(
      dialog.getByText('Google’s numbers for this property couldn’t be loaded.'),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** On a phone the same steps fill the screen as a sheet. */
export const PhoneFullScreen: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const frame = document.body.querySelector('[data-wizard-frame]')
    await expect(frame).toHaveAttribute('data-wizard-frame', 'sheet')
    await expect(dialog.getByRole('slider', { name: 'Goal on Google' })).toBeVisible()
    await toPace(dialog)
    await expect(dialog.getByRole('radio', { name: /^Faster/ })).toBeChecked()
  },
}

export const DesktopDialog: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    await open(canvasElement)
    await expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
      'data-wizard-frame',
      'dialog',
    )
  },
}

export const PhonePaceLight: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await toPace(dialog)
  },
}
