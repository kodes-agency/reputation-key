// The Google rating goal wizard, step by step, on a desktop (a dialog) and a
// phone (a full-screen sheet). The Storybook Vitest project compiles no
// Tailwind, so nothing here claims a pixel; the plays prove what a screenshot
// cannot: the slider moves by tenths from the keyboard, 5.0 is on the scale and
// never chosen, an out-of-reach stop warns, a pace typed in is held to 1-200 and
// cautions above twice the pace now, what is saved, the done screen's one next
// step, a refusal in plain words, a change that sends only what differs, what
// was picked surviving a phone turned to landscape, and the focus going back
// to what opened the wizard.
import { useRef, useState } from 'react'
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
  const door = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={door}
        onClick={() => setOpening(({ key }) => ({ open: true, key: key + 1 }))}
      >
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
        // As the page's host does: no trigger, so the focus is handed back here.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!opening.open) door.current?.focus()
        }}
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
    // Polite: it changes with every step of the thumb, whose value text already
    // says "out of reach"; an alert would cut that off.
    const warning = await dialog.findByRole('status')
    await expect(warning).toHaveTextContent(
      'Out of reach: even at 11 new reviews a week this takes more than a year. You can still pick it.',
    )
    await expect(dialog.queryByRole('alert')).toBeNull()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    // 4.8 is worked out at its own recommended quality (5.0★), so it is a count.
    await expect(dialog.getByText('About 1,430 more reviews')).toBeVisible()
    await expect(dialog.getByRole('status')).toHaveTextContent(
      'Out of reach: even at 11 new reviews a week this takes more than a year. You can still pick it.',
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
    await expect(dialog.getByText('For 4.4 on Google')).toBeVisible()
    await expect(dialog.getByText('You get about 7 a week now')).toBeVisible()
    // The group says what is being chosen; the pace now describes it.
    const group = dialog.getByRole('radiogroup', { name: 'New Google reviews a week' })
    await expect(group).toHaveAccessibleDescription('You get about 7 a week now')
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

    // A card's words pick its pace, not only its radio. (The label also stretches
    // over the card's padding; that is CSS, which this project does not compile.)
    await userEvent.click(dialog.getByText('Around Dec 2026 – Mar 2027'))
    await expect(dialog.getByRole('radio', { name: /^Steady/ })).toBeChecked()
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
          qualityTenths: 47,
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
    // The title, one sentence and "Start watching": nothing said twice.
    await expect(
      dialog.getByText('We’ll watch that Google keeps showing 5.0.'),
    ).toBeVisible()
    await expect(dialog.queryByText(/Google shows 5\.0/)).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await waitFor(() =>
      expect(setMock).toHaveBeenCalledWith({
        data: {
          propertyId: FIXTURE_PROPERTY_ID,
          mode: 'keep',
          targetTenths: 50,
          qualityTenths: null,
          pacePerWeek: null,
        },
      }),
    )
    await expect(await dialog.findByText('Keeping 5.0 on Google')).toBeVisible()
    // Nothing is higher than 5.0, so the done screen does not offer to aim higher.
    await expect(dialog.getByText('You can end it at any time.')).toBeVisible()
  },
}

/** "Keep 4.5" after reaching it: one step, and the done screen offers to aim higher. */
export const KeepAfterReaching: Story = {
  args: { intent: { kind: 'keep', targetTenths: 45 } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement, 'Keep 4.5 on Google')
    await expect(
      dialog.getByText('We’ll watch that Google keeps showing 4.5.'),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await expect(await dialog.findByText('Keeping 4.5 on Google')).toBeVisible()
    await expect(dialog.getByText('You can aim higher at any time.')).toBeVisible()
  },
}

/** A change opens on the goal's own target and pace and sends only what differs. */
export const ChangeTargetOrPace: Story = {
  args: { intent: { kind: 'change', goal: CARD } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement, 'Change your goal')
    await expect(dialog.getByRole('slider', { name: 'Goal on Google' })).toHaveAttribute(
      'aria-valuetext',
      '4.5, stretch, about 455 more reviews',
    )
    await toPace(dialog)
    const save = dialog.getByRole('button', { name: 'Save changes' })
    await expect(dialog.getByRole('radio', { name: /^Faster/ })).toBeChecked()
    await expect(save).toBeDisabled()
    // A dead button says why it is dead.
    await expect(dialog.getByText('Change the goal or the pace to save.')).toBeVisible()
    await userEvent.click(dialog.getByRole('radio', { name: /^Push/ }))
    await expect(dialog.queryByText('Change the goal or the pace to save.')).toBeNull()
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
    const dialog = await open(canvasElement, 'Change your goal')
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

/**
 * The dialog gives way to the full-screen sheet mid-wizard (a window narrowed,
 * a phone turned): the target and the pace picked so far stay picked, and the
 * pace step names the target it is for.
 */
export const KeepsWhatWasPickedAcrossTheFrames: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const slider = dialog.getByRole('slider', { name: 'Goal on Google' })
    slider.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await toPace(dialog)
    await userEvent.click(dialog.getByRole('radio', { name: /^Steady/ }))
    const undo = turnPhone(true)
    try {
      await waitFor(() =>
        expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
          'data-wizard-frame',
          'sheet',
        ),
      )
      const sheet = within(await within(document.body).findByRole('dialog'))
      await expect(sheet.getByRole('heading', { name: 'Pick your pace' })).toBeVisible()
      await expect(sheet.getByText('For 4.6 on Google')).toBeVisible()
      await expect(sheet.getByRole('radio', { name: /^Steady/ })).toBeChecked()
      await userEvent.click(sheet.getByRole('button', { name: 'Back to your goal' }))
      await expect(sheet.getByRole('slider', { name: 'Goal on Google' })).toHaveAttribute(
        'aria-valuenow',
        '46',
      )
    } finally {
      undo()
    }
  },
}

/** No trigger opened it, so the wizard hands the focus back to what did. */
export const FocusGoesBackOnClose: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('button', { name: 'Open the wizard' }),
      ).toHaveFocus(),
    )
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
