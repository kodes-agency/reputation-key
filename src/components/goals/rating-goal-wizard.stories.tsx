// The Google rating goal wizard, "Pick a plan" (round 2, R2-6 to R2-12), on a
// desktop (a dialog) and a phone (a full-screen sheet), dark and light. The
// Storybook Vitest project compiles no Tailwind, so nothing here claims a pixel;
// the plays prove what a screenshot cannot: the three plans and what each says,
// the quality they share and its "Change", the policy line, the three rows of
// "Build your own" with their recommendations and "Own" (the slider of tenths
// with 5.0 never chosen, the average held to the target's floor, the pace held
// to 1-200 with a surge caution), the live total, what is saved, the done
// screen's one next step, a refusal in plain words, a change that opens on
// "Your plan" and sends only what differs, what was picked surviving a phone
// turned to landscape, and the focus going back to what opened the wizard.
import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { Button } from '#/components/ui/button'
import { RatingGoalWizard, type RatingGoalWizardProps } from './rating-goal-wizard'
import { PLAN_POLICY_LINE } from './rating-goal-copy'
import { wholeText } from './rating-goal-wizard.stories.play'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
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

const read = (data: typeof SETUP | undefined) => ({
  data,
  failed: false,
  retrying: false,
  retry: () => undefined,
})

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
        setup={read(SETUP_BETA)}
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

/** Opens the wizard and waits for its title. */
async function open(canvasElement: HTMLElement, title = 'Pick a plan') {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open the wizard' }),
  )
  const dialog = within(await within(document.body).findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('heading', { name: title })).toBeVisible())
  return dialog
}

type Dialog = Awaited<ReturnType<typeof open>>

const plan = (dialog: Dialog, name: RegExp) => dialog.getByRole('radio', { name })

async function openBuildYourOwn(dialog: Dialog) {
  const trigger = dialog.getByRole('button', { name: 'Build your own' })
  await userEvent.click(trigger)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

const row = (dialog: Dialog, name: string) =>
  within(dialog.getByRole('radiogroup', { name }))

/** Presses "Set goal" and checks the plan sent: target and average in tenths, the pace in tenths of a review a week. */
async function setsPlan(
  dialog: Dialog,
  targetTenths: number,
  qualityTenths: number,
  pacePerWeek: number,
) {
  await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
  await waitFor(() =>
    expect(setMock).toHaveBeenCalledWith({
      data: {
        propertyId: FIXTURE_PROPERTY_ID,
        mode: 'climb',
        targetTenths,
        qualityTenths,
        paceTenthsPerWeek: pacePerWeek * 10,
      },
    }),
  )
}

/** Opens Build your own, picks "Own" in a row and returns its field. */
async function ownField(dialog: Dialog, rowName: string, fieldName: string) {
  await openBuildYourOwn(dialog)
  await userEvent.click(row(dialog, rowName).getByRole('radio', { name: 'Own' }))
  return dialog.getByRole('spinbutton', { name: fieldName })
}

/** The beta property (3.9 from 261): three plans on its best year's 4.5★, Recommended picked. */
export const PickAPlan: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.getByText('Google shows 3.9 from 261 reviews.')).toBeVisible()
    const plans = dialog.getByRole('radiogroup', { name: 'Plans' })
    await expect(plans).toHaveAccessibleDescription(
      'Plans assume new reviews average 4.5★, like your best year (2024)',
    )
    await expect(plan(dialog, /^Recommended 4\.0 on Google$/)).toBeChecked()
    // The dialog opens on the plan it has picked, not on "Change" above it.
    await waitFor(() => expect(plan(dialog, /^Recommended/)).toHaveFocus())
    await expect(plan(dialog, /^Recommended/)).toHaveAccessibleDescription(
      '2 a week · new reviews 4.5★ · 19 reviews Around Dec 2026 – Jan 2027',
    )
    await expect(plan(dialog, /^Cautious 4\.0/)).toHaveAccessibleDescription(
      '1 a week · new reviews 4.5★ · 19 reviews Around Jan–Apr 2027',
    )
    await expect(plan(dialog, /^Ambitious 4\.1/)).toHaveAccessibleDescription(
      // 81 reviews at 3 a week are 27 weeks: Ambitious stays within a year (4.2 would not).
      '3 a week · new reviews 4.5★ · 81 reviews Around Mar–Jul 2027',
    )
    await expect(dialog.getByText(PLAN_POLICY_LINE)).toBeVisible()
    // Build your own waits, folded: the first screen leads with the three plans.
    await expect(dialog.getByRole('button', { name: 'Build your own' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(dialog.queryByRole('radiogroup', { name: 'Goal on Google' })).toBeNull()
  },
}

/** The healthy property (4.3 from 812, recent 4.7★, 7 a week) opens on 4.4. */
export const HealthyProperty: Story = {
  args: { setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.getByText('Google shows 4.3 from 812 reviews.')).toBeVisible()
    await expect(
      dialog.getByText('Plans assume new reviews average 4.7★, like your recent reviews'),
    ).toBeVisible()
    await expect(plan(dialog, /^Recommended 4\.4/)).toHaveAccessibleDescription(
      '11 a week · new reviews 4.7★ · 93 reviews Around Nov 2026 – Jan 2027',
    )
    // 4.7★ clears 4.6 too, but 1,300 reviews at 14 a week run past a year: 4.5 (455) does not.
    await expect(plan(dialog, /^Ambitious 4\.5/)).toHaveAccessibleDescription(
      '14 a week · new reviews 4.7★ · 455 reviews Around Mar–Dec 2027',
    )
  },
}

/** The keyboard moves between the plans; Set goal sends the one picked. */
export const PicksAnotherPlan: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const recommended = plan(dialog, /^Recommended/)
    recommended.focus()
    // Radix checks the radio that takes the focus only while the arrow is held.
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(plan(dialog, /^Ambitious/)).toHaveFocus())
    await userEvent.keyboard('{/ArrowRight}')
    await expect(plan(dialog, /^Ambitious/)).toBeChecked()
    await setsPlan(dialog, 41, 45, 3)
  },
}

export const SetsTheRecommendedPlan: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await setsPlan(dialog, 40, 45, 2)
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'Your goal is set' })).toHaveFocus(),
    )
    await expect(dialog.getByText('4.0 on Google')).toBeVisible()
    await expect(dialog.getByText('About 2 new reviews a week')).toBeVisible()
    await expect(
      dialog.getByText(wholeText('Expected around Dec 2026 – Jan 2027')),
    ).toBeVisible()
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
    await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
    await expect(
      await dialog.findByRole('link', { name: 'Create a portal' }),
    ).toBeVisible()
    await expect(dialog.queryByRole('link', { name: 'Set portal goals' })).toBeNull()
  },
}

/**
 * "Change" opens Build your own on its average row, with the focus there; the
 * plans let go, and the total answers the average picked.
 */
export const ChangeTheQuality: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Change' }))
    await expect(dialog.getByRole('button', { name: 'Build your own' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const quality = row(dialog, 'New reviews will average')
    await waitFor(() =>
      expect(quality.getByRole('radio', { name: '4.5★' })).toHaveFocus(),
    )
    await expect(plan(dialog, /^Recommended/)).not.toBeChecked()
    await expect(
      dialog.getByRole('radiogroup', { name: 'New reviews will average' }),
    ).toHaveAccessibleDescription(
      'For 4.0 on Google, new reviews need to average above 3.95★. Your last 25 averaged 3.92★.',
    )
    await expect(
      quality.getByRole('radio', { name: '4.5★' }),
    ).toHaveAccessibleDescription(
      'Like your best year (2024) · about 19 reviews Recommended',
    )
    await expect(
      dialog.getByText(wholeText('19 more reviews · around Dec 2026 – Jan 2027')),
    ).toBeVisible()

    await userEvent.click(quality.getByRole('radio', { name: '4.8★' }))
    await expect(
      dialog.getByText(wholeText('12 more reviews · around Nov–Dec 2026')),
    ).toBeVisible()
    await setsPlan(dialog, 40, 48, 2)
  },
}

/** Each row offers three, one Recommended, and "Own"; the average row follows the goal. */
export const BuildYourOwn: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
    const target = row(dialog, 'Goal on Google')
    await expect(target.getByRole('radio', { name: '4.0' })).toBeChecked()
    await expect(target.getByRole('radio', { name: '4.0' })).toHaveAccessibleDescription(
      'Realistic Recommended',
    )
    await expect(target.getByRole('radio', { name: '4.2' })).toHaveAccessibleDescription(
      'Out of reach',
    )
    await expect(target.getByRole('radio', { name: 'Own' })).toBeVisible()
    const pace = row(dialog, 'New reviews a week')
    await expect(pace.getByRole('radio', { name: 'Faster' })).toBeChecked()
    await expect(pace.getByRole('radio', { name: 'Faster' })).toHaveAccessibleDescription(
      '2 a week Recommended',
    )

    await userEvent.click(target.getByRole('radio', { name: '4.1' }))
    await expect(
      row(dialog, 'New reviews will average').getByRole('radio', { name: '4.4★' }),
    ).toHaveAccessibleDescription('A step above what 4.1 needs · about 103 reviews')
    await userEvent.click(pace.getByRole('radio', { name: 'Push' }))
    await expect(
      dialog.getByText(wholeText('81 more reviews · around Mar–Jul 2027')),
    ).toBeVisible()
    await setsPlan(dialog, 41, 45, 3)
  },
}

/**
 * A new goal keeps a picked average it also offers, and moves one it does not
 * to its recommendation, so the average row never turns to "Own" unseen; a plan
 * more than a year away says so beside the total.
 */
export const AverageFollowsTheGoal: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
    const quality = row(dialog, 'New reviews will average')
    await userEvent.click(quality.getByRole('radio', { name: '4.3★' }))
    await expect(
      dialog.getByText(wholeText('29 more reviews · around Dec 2026 – Mar 2027')),
    ).toBeVisible()

    // 4.2 offers 4.5★ (recommended) and 4.8★, not "a step above what 4.0 needs".
    await userEvent.click(
      row(dialog, 'Goal on Google').getByRole('radio', { name: '4.2' }),
    )
    await expect(quality.getByRole('radio', { name: '4.5★' })).toBeChecked()
    await expect(quality.getByRole('radio', { name: 'Own' })).not.toBeChecked()
    // 178 reviews at 2 a week: "More than a year" beside the total. No plan card
    // says it: Ambitious stays within a year, 4.2 is only here, in Build your own.
    await expect(
      dialog.getByText(wholeText('178 more reviews · around Dec 2027 – Jun 2029')),
    ).toBeVisible()
    await expect(dialog.getAllByText('More than a year')).toHaveLength(1)
    await setsPlan(dialog, 42, 45, 2)
  },
}

/** Closing Build your own makes the plan it opened from the plan again. */
export const ClosingBuildYourOwn: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await userEvent.click(plan(dialog, /^Cautious/))
    await openBuildYourOwn(dialog)
    await expect(plan(dialog, /^Cautious/)).not.toBeChecked()
    await expect(
      row(dialog, 'New reviews a week').getByRole('radio', { name: 'Steady' }),
    ).toBeChecked()
    await userEvent.click(dialog.getByRole('button', { name: 'Build your own' }))
    await expect(plan(dialog, /^Cautious/)).toBeChecked()
  },
}

/** The goal's own slider: tenths from 4.0 to 4.9, each with its label; 5.0 is never chosen. */
export const OwnGoalSlider: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
    await userEvent.click(
      row(dialog, 'Goal on Google').getByRole('radio', { name: 'Own' }),
    )
    const slider = dialog.getByRole('slider', { name: 'Your own goal on Google' })
    await expect(slider).toHaveAttribute('aria-valuetext', '4.0, realistic')
    await expect(slider).toHaveAttribute('aria-valuemax', '49')
    await expect(
      dialog.getByText('5.0 needs every review from now on to be 5★'),
    ).toBeVisible()
    // The goal picked, large, with its label, as the target row's options wear it.
    await expect(dialog.getAllByText('Realistic')).toHaveLength(2)
    slider.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    await expect(slider).toHaveAttribute('aria-valuetext', '4.3, out of reach')
    await expect(dialog.getByText('4.3')).toBeVisible()
    await expect(dialog.getAllByText('Out of reach')).toHaveLength(2)
    await expect(
      dialog.getByText(wholeText('353 more reviews · around Dec 2028 – Jan 2033')),
    ).toBeVisible()
    // More than a year at 2 a week, said before Set goal is pressed.
    await expect(dialog.getAllByText('More than a year')).toHaveLength(1)
    await userEvent.keyboard('{End}{ArrowRight}')
    await expect(slider).toHaveAttribute('aria-valuenow', '49')
  },
}

/** An average of one's own is held to the target's floor, in plain words. */
export const OwnAverageFloor: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const field = await ownField(
      dialog,
      'New reviews will average',
      'Your own average (stars)',
    )
    await expect(field).toHaveValue(4.5)
    const save = dialog.getByRole('button', { name: 'Set goal' })
    await userEvent.clear(field)
    await userEvent.type(field, '4')
    await expect(
      dialog.getByText(
        'For 4.0, pick 4.1★ or more: any nearer 3.95★ and the reviews needed climb very fast.',
      ),
    ).toBeVisible()
    await expect(save).toBeDisabled()
    await expect(
      dialog.getByText('Fix the average marked above to see what this plan takes.'),
    ).toBeVisible()
    await userEvent.clear(field)
    await userEvent.type(field, '4.2')
    await expect(
      dialog.getByText(wholeText('40 more reviews · around Jan–Jul 2027')),
    ).toBeVisible()
    await expect(save).toBeEnabled()
  },
}

/** A pace of one's own is a whole number from 1 to 200, with a caution above twice the pace now. */
export const OwnPaceBounds: Story = {
  args: { setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const field = await ownField(dialog, 'New reviews a week', 'Your own number a week')
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
    await expect(
      dialog.getByText(wholeText('93 more reviews · around Nov 2026 – Jan 2027')),
    ).toBeVisible()
  },
}

export const RefusedInPlainWords: Story = {
  play: async ({ canvasElement }) => {
    setMock.mockRejectedValueOnce(refusal('goal_exists'))
    const dialog = await open(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Set goal' }))
    await expect(
      await dialog.findByText(
        'This property already has a Google rating goal. Close this to see it on the Goals page.',
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Pick a plan' })).toBeVisible()
  },
}

/** Google shows 5.0 and there is nothing higher: one step, to keep it. */
export const KeepFirst: Story = {
  args: { intent: { kind: 'keep', targetTenths: 50 }, setup: read(SETUP_KEEP_FIRST) },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement, 'Keep 5.0 on Google')
    // The title, one sentence and "Start watching": nothing said twice.
    await expect(
      dialog.getByText('We’ll watch that Google keeps showing 5.0.'),
    ).toBeVisible()
    await expect(dialog.queryByRole('radiogroup', { name: 'Plans' })).toBeNull()
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
    // Nothing is higher than 5.0, so the done screen does not offer to aim higher.
    await expect(dialog.getByText('You can end it at any time.')).toBeVisible()
  },
}

/**
 * "Keep 4.9" after reaching it (Keep is offered only at 4.9 or 5.0, R2-9): one
 * step, and the done screen says it can be ended, as nothing is higher to aim for.
 */
export const KeepAfterReaching: Story = {
  args: { intent: { kind: 'keep', targetTenths: 49 } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement, 'Keep 4.9 on Google')
    await userEvent.click(dialog.getByRole('button', { name: 'Start watching' }))
    await expect(await dialog.findByText('Keeping 4.9 on Google')).toBeVisible()
    await expect(dialog.getByText('You can end it at any time.')).toBeVisible()
  },
}

/**
 * A change opens on the goal's own plan, "Your plan", with Build your own
 * prefilled from it, and sends only what differs.
 */
export const ChangePlan: Story = {
  args: { intent: { kind: 'change', goal: CARD }, setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    const yours = plan(dialog, /^Your plan 4\.5 on Google$/)
    await expect(yours).toBeChecked()
    await expect(yours).toHaveAccessibleDescription(
      '11 a week · new reviews 4.7★ · 455 reviews Around Apr 2027 – Apr 2028',
    )
    const save = dialog.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()
    // A dead button says why it is dead, beside it in the footer.
    await expect(dialog.getByText('Change the plan to save.')).toBeVisible()
    await expect(save).toHaveAccessibleDescription('Change the plan to save.')

    await openBuildYourOwn(dialog)
    await expect(
      row(dialog, 'Goal on Google').getByRole('radio', { name: '4.5' }),
    ).toBeChecked()
    await expect(
      row(dialog, 'New reviews will average').getByRole('radio', { name: '4.7★' }),
    ).toBeChecked()
    const pace = row(dialog, 'New reviews a week')
    await expect(pace.getByRole('radio', { name: 'Faster' })).toBeChecked()
    await userEvent.click(pace.getByRole('radio', { name: 'Push' }))
    await expect(dialog.queryByText('Change the plan to save.')).toBeNull()
    await expect(
      dialog.getByText(wholeText('455 more reviews · around Mar–Dec 2027')),
    ).toBeVisible()
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

export const ChangeAfterAnotherChange: Story = {
  args: { intent: { kind: 'change', goal: CARD }, setup: read(SETUP) },
  play: async ({ canvasElement }) => {
    changeMock.mockRejectedValueOnce(refusal('version_conflict'))
    const dialog = await open(canvasElement)
    await userEvent.click(plan(dialog, /^Recommended/))
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
    await expect(
      await dialog.findByText(
        'This goal changed after you opened this. Close it and open it again to start from the latest.',
      ),
    ).toBeVisible()
  },
}

export const SetupStillReading: Story = {
  args: { setup: read(undefined) },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(dialog.queryByRole('radiogroup')).toBeNull()
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

/** On a phone the same step fills the screen as a sheet. */
export const PhoneFullScreen: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
      'data-wizard-frame',
      'sheet',
    )
    await expect(plan(dialog, /^Recommended/)).toBeChecked()
    await openBuildYourOwn(dialog)
    await expect(dialog.getByRole('radiogroup', { name: 'Goal on Google' })).toBeVisible()
  },
}

export const PhoneLight: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
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

export const DesktopLight: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
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
 * The dialog gives way to the full-screen sheet mid-pick (a window narrowed, a
 * phone turned): Build your own stays open with what was picked in it.
 */
export const KeepsWhatWasPickedAcrossTheFrames: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement }) => {
    const dialog = await open(canvasElement)
    await openBuildYourOwn(dialog)
    await userEvent.click(
      row(dialog, 'Goal on Google').getByRole('radio', { name: '4.1' }),
    )
    await userEvent.click(
      row(dialog, 'New reviews a week').getByRole('radio', { name: 'Push' }),
    )
    const undo = turnPhone(true)
    try {
      await waitFor(() =>
        expect(document.body.querySelector('[data-wizard-frame]')).toHaveAttribute(
          'data-wizard-frame',
          'sheet',
        ),
      )
      const sheet = within(await within(document.body).findByRole('dialog'))
      await expect(sheet.getByRole('button', { name: 'Build your own' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(
        row(sheet, 'Goal on Google').getByRole('radio', { name: '4.1' }),
      ).toBeChecked()
      await expect(
        row(sheet, 'New reviews a week').getByRole('radio', { name: 'Push' }),
      ).toBeChecked()
      await expect(
        sheet.getByText(wholeText('81 more reviews · around Mar–Jul 2027')),
      ).toBeVisible()
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
