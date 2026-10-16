// The Google rating goal's detail page, the full monitoring view: "Your plan"
// against what happened since it was set (before and after ten reviews, and
// new reviews too low), both forecasts and the best case, the bar from the start with the next tenth, the
// three tiles, the weekly bars against the pace, the star mix, the change log
// and the foot; and its actions, which only a manager allowed to change or end
// a goal sees. The Storybook Vitest project compiles no Tailwind, so the plays
// assert words, roles and what the actions do, not pixels.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { RatingGoalDetail, RatingGoalMissing } from './rating-goal-detail'
import { RatingGoalDetailActions } from './rating-goal-detail-actions'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import { DETAIL_BEFORE_TEN, DETAIL_TOO_LOW } from './rating-goal-plan.stories.fixtures'
import {
  DETAIL,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'
import { wholeText } from './rating-goal-wizard.stories.play'

const NOW = new Date(FIXTURE_NOW)
const NAMES: Readonly<Record<string, string>> = { 'user-ana': 'Ana Petrova' }

const meta: Meta<typeof RatingGoalDetail> = {
  title: 'Goals/RatingGoalDetail',
  component: RatingGoalDetail,
  parameters: { layout: 'padded' },
  args: {
    detail: DETAIL,
    readAt: NOW,
    timezone: FIXTURE_TIMEZONE,
    now: NOW,
    personName: (userId: string) => NAMES[userId] ?? null,
  },
  render: (args) => (
    <div className="max-w-5xl">
      <RatingGoalDetail {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>

/** A goal that looks forward no more: no pace line, no bar, no tiles. */
async function looksNoFurther(
  canvas: ReturnType<typeof within>,
  canvasElement: HTMLElement,
) {
  await expect(canvas.queryByText(/^Your pace/)).toBeNull()
  await expect(canvas.queryByRole('progressbar')).toBeNull()
  await expect(canvasElement.querySelector('[data-slot="metric-strip"]')).toBeNull()
}

export const Monitoring: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Reach 4.5 on Google' }),
    ).toBeVisible()
    const plan = within(canvas.getByRole('region', { name: 'Your plan' }))
    await expect(plan.getByText('Google shows')).toBeVisible()
    await expect(plan.getByText('4.3 · goal 4.5')).toBeVisible()
    await expect(plan.getByText('New reviews average')).toBeVisible()
    await expect(plan.getByText('4.61★ · plan 4.7★')).toBeVisible()
    await expect(
      plan.getByText(
        '107 reviews since the goal was set · forecasts use 4.62★, your plan mixed with them',
      ),
    ).toBeVisible()
    await expect(plan.getByText('1.4 a day · plan 1.6 a day')).toBeVisible()
    await expect(plan.getByText('About 11 a week · 50 a month')).toBeVisible()
    // The plan's pace is in the plan, not said again above it.
    await expect(canvas.queryByText(/^Your pace:/)).toBeNull()
    await expect(canvas.getByText('At your chosen pace, 1.6 a day')).toBeVisible()
    await expect(
      canvas.getByText(wholeText('Expected around Mar–Nov 2027')),
    ).toBeVisible()
    await expect(
      canvas.getByText('At your pace of the last 4 weeks, 1.4 a day'),
    ).toBeVisible()
    await expect(
      canvas.getByText(wholeText('Expected around Jul–Sep 2027')),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'If every new review is 5★: 97 more reviews, about 2 months at 1.6 a day.',
      ),
    ).toBeVisible()

    await expect(canvas.getByText('Started at 4.31')).toBeVisible()
    await expect(canvas.getByText('4.45 shows 4.5')).toBeVisible()
    await expect(
      canvas.getByText('Next: Google shows 4.4 after about 31 more reviews'),
    ).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="progress-bar-marker"]'),
    ).toBeInTheDocument()

    const strip = canvasElement.querySelector<HTMLElement>('[data-slot="metric-strip"]')
    await expect(strip).toHaveAttribute('aria-label', 'This goal in numbers')
    const tiles = within(strip!)
    await expect(tiles.getByText('6 of 11')).toBeVisible()
    await expect(tiles.getByText('1.4 a day')).toBeVisible()
    await expect(tiles.getByText('212 reviews')).toBeVisible()

    await expect(
      canvas.getByText('107 reviews since the goal was set · average 4.61★'),
    ).toBeVisible()
    await expect(canvas.getByText('Pace 2 → 1.6 a day')).toBeVisible()
    await expect(canvas.getByText('Target 4.4 → 4.5')).toBeVisible()
    await expect(canvas.getAllByText(/^Ana Petrova · /)).toHaveLength(2)
    await expect(
      canvas.getByText(
        'Google numbers checked 12 minutes ago · Owners and managers only',
      ),
    ).toBeVisible()
    // The weekly bars arrive in their own chunk, after the numbers.
    await expect(
      // Its own chunk (recharts) can take a while on a loaded runner.
      await canvas.findByRole(
        'img',
        { name: 'New Google reviews each week' },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
  },
}

/** A goal to keep, set while Google showed 4.9 (Keep is offered only at 4.9 or 5.0). */
export const KeepGoal: Story = {
  args: {
    detail: {
      ...DETAIL,
      mode: 'keep',
      targetTenths: 49,
      target: 4.9,
      threshold: 4.85,
      google: { ...DETAIL.google!, shows: 4.9 },
      exactAverage: 4.912,
      qualityTenths: null,
      quality: null,
      qualityBasis: null,
      plan: null,
      paceTenthsPerWeek: null,
      status: 'holding',
      progress: null,
      stillNeeded: null,
      bestCase: null,
      forecast: null,
      forecastAtChosenPace: null,
      forecastAtActualPace: null,
      nextTenth: null,
      changes: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Keeping 4.9 on Google' }),
    ).toBeVisible()
    await looksNoFurther(canvas, canvasElement)
    await expect(canvas.getByText('No changes since the goal was set.')).toBeVisible()
  },
}

/**
 * The beta property's goal a fortnight in: four reviews since it was set, so no
 * verdict on their stars yet; the numbers mix them into the plan's 4.5★.
 */
export const BeforeTenReviews: Story = {
  args: { detail: DETAIL_BEFORE_TEN },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const plan = within(canvas.getByRole('region', { name: 'Your plan' }))
    await expect(plan.getByText('3.9 · goal 4.0')).toBeVisible()
    await expect(plan.getByText('after 10 reviews · plan 4.5★')).toBeVisible()
    await expect(
      plan.getByText(
        '4 reviews since the goal was set · forecasts use 4.55★, your plan mixed with them',
      ),
    ).toBeVisible()
    await expect(plan.getByText('2 a week · plan 2 a week')).toBeVisible()
    await expect(canvas.queryByRole('alert')).toBeNull()
    // Both forecasts assume the plan's 4.5★ mixed with the four reviews.
    await expect(
      canvas.getAllByText(wholeText('Expected around Dec 2026 – Feb 2027')),
    ).toHaveLength(2)
  },
}

/**
 * Twelve reviews since the set average 3.75★, at or below what 4.0 needs: said
 * once, with what helps, not under each pace; the plan shows the average as it is.
 */
export const NewReviewsTooLow: Story = {
  args: { detail: DETAIL_TOO_LOW },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Since you set the goal, new reviews average below what 4.0 needs. Your Portals offer every guest the same Google review link.',
    )
    await expect(canvas.getAllByText(/average below what 4\.0 needs/)).toHaveLength(1)
    await expect(canvas.queryByText(/^At your chosen pace/)).toBeNull()
    await expect(canvas.getByText('Not reachable')).toBeVisible()
    await expect(canvas.getByText('at the new reviews’ average')).toBeVisible()
    const plan = within(canvas.getByRole('region', { name: 'Your plan' }))
    await expect(plan.getByText('3.75★ · plan 4.5★')).toBeVisible()
    await expect(
      plan.getByText('12 reviews since the goal was set · forecasts use their average'),
    ).toBeVisible()
  },
}

export const NewReviewsTooLowLight: Story = {
  args: { detail: DETAIL_TOO_LOW },
  parameters: { theme: 'light' },
}

export const BeforeTenReviewsPhone: Story = {
  args: { detail: DETAIL_BEFORE_TEN },
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('after 10 reviews · plan 4.5★'),
    ).toBeVisible()
  },
}

export const GoogleShouldShowItSoon: Story = {
  args: { detail: { ...DETAIL, googleShowsSoon: true, progress: 1 } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/^Google should show 4\.5 soon\./),
    ).toBeVisible()
  },
}

/** Google's numbers are a day old: the last number with its date, and the chip says why. */
export const WaitingForGoogle: Story = {
  args: {
    detail: {
      ...DETAIL,
      status: 'waiting_for_google',
      google: { ...DETAIL.google!, current: false, asOf: '2026-10-12T08:00:00.000Z' },
    },
    readAt: NOW,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('as of Oct 12')).toBeVisible()
    await expect(
      canvas.getByText('Google numbers checked 2 days ago · Owners and managers only'),
    ).toBeVisible()
  },
}

/** RepKey holds fewer reviews than Google counts: the average is Google's, and says so. */
export const ApproximateNumbers: Story = {
  args: {
    detail: { ...DETAIL, exactAverage: 4.3, exactAverageSource: 'google' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('About 4.30 of 4.45')).toBeVisible()
    await expect(canvas.queryByText(/^Exact average/)).toBeNull()
    await expect(
      canvas.getByText(
        'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.',
      ),
    ).toBeVisible()
  },
}

/** Found reached: what it was and how it went, nothing that looks ahead. */
export const FoundReached: Story = {
  args: {
    detail: {
      ...DETAIL,
      state: 'reached',
      status: 'reached',
      google: { ...DETAIL.google!, shows: 4.5 },
      exactAverage: 4.452,
      progress: 1,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/^Google shows 4\.5: the goal is reached\./),
    ).toBeVisible()
    await expect(canvas.queryByText(/^Expected around/)).toBeNull()
    await looksNoFurther(canvas, canvasElement)
    await expect(canvas.getByText('Pace 2 → 1.6 a day')).toBeVisible()
  },
}

export const FoundEnded: Story = {
  args: {
    detail: { ...DETAIL, state: 'ended', endedReason: 'google_location_changed' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/^Ended: Google location changed\. It is in History now/),
    ).toBeVisible()
    await expect(canvas.queryByText(/^Expected around/)).toBeNull()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** The page of a Property with no goal (ended elsewhere, or never set): the way back. */
export const NoGoal: StoryObj<typeof RatingGoalMissing> = {
  render: () => <RatingGoalMissing propertyId={FIXTURE_PROPERTY_ID} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('This property has no Google rating goal'),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to goals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals`,
    )
  },
}

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'Next: Google shows 4.4 after about 31 more reviews',
      ),
    ).toBeVisible()
  },
}

export const Light: Story = { parameters: { theme: 'light' } }

const onChange = fn()
const onEnd = fn(async () => undefined)

/** A manager sees both actions; ending confirms first, in the destructive tone. */
export const Actions: StoryObj<typeof RatingGoalDetailActions> = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
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
export const EndRefused: StoryObj<typeof RatingGoalDetailActions> = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
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
export const ActionsHiddenWithoutPermission: StoryObj<typeof RatingGoalDetailActions> = {
  decorators: [withRole('Member')],
  render: () => (
    <div data-testid="actions" className="flex gap-2">
      <RatingGoalDetailActions goal={DETAIL} setup={SETUP} onChange={fn()} onEnd={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** A goal to keep changes only to a plan the setup offers: none while Google shows 5.0. */
export const KeepGoalWithNothingHigher: StoryObj<typeof RatingGoalDetailActions> = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
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
