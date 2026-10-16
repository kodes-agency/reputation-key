// The Google section of the Goals page in every state it can be in: the simple
// card of an active goal (each status, and a goal to keep), a goal reached or
// ended lately (found by the card read, or by the snapshot consumer and so read
// from History), the door into the wizard, the "keep" door, the reasons there is
// no goal yet, a read on its way or failed, and a reader who cannot set goals. The Storybook Vitest project compiles no Tailwind, so the plays assert
// words, roles and what each door opens, not pixels.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { Button } from '#/components/ui/button'
import { RatingGoalHistory } from './rating-goal-history'
import { RatingGoalSection } from './rating-goal-section'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
import { SETUP_BETA } from './rating-goal-plan.stories.fixtures'
import {
  CARD_ACTUAL_PACE,
  CARD_FAR_GOAL,
  CARD_GETTING_STARTED,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_HARBORLINE_JUST_SET,
  CARD_LAGS,
  CARD_LAGS_MIDDLE,
  CARD_NO_PACE,
  CARD_OPEN_SLOW,
  CARD_TOO_LOW,
  CARD_WAITING,
} from './rating-goal-tracking.stories.fixtures'
import {
  CARD,
  CARD_KEEP,
  CARD_REACHED,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
  HISTORY,
  SETUP,
  SETUP_FEW_REVIEWS,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'
import type {
  RatingGoalCardView,
  RatingGoalHistoryEntry,
} from '#/contexts/reporting/application/dto/rating-goal.types'
import { wholeText } from './rating-goal-wizard.stories.play'

const NOW = new Date(FIXTURE_NOW)
const read = <T,>(data: T | undefined, failed = false) => ({
  data,
  failed,
  retrying: false,
  retry: fn(),
})
const cardRead = (data: RatingGoalCardView | null | undefined, failed = false) => ({
  ...read(data, failed),
  readAt: NOW,
})

/** The goal of CARD, reached two days ago: the snapshot consumer got there first. */
const REACHED_LATELY: RatingGoalHistoryEntry = {
  ...HISTORY[0]!,
  goalId: CARD.goalId,
  targetTenths: 45,
  target: 4.5,
  paceTenthsPerWeek: 110,
  setAt: CARD.setAt,
  reachedAt: '2026-10-12T05:10:00.000Z',
}
/** What the setup reads once Google shows the target. */
const SETUP_SHOWS_45 = { ...SETUP, google: { ...SETUP.google!, shows: 4.5 } }

const meta: Meta<typeof RatingGoalSection> = {
  title: 'Goals/RatingGoalSection',
  component: RatingGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: FIXTURE_PROPERTY_ID,
    timezone: FIXTURE_TIMEZONE,
    now: NOW,
    card: cardRead(CARD),
    setup: read(undefined),
    history: read([]),
    hasPortals: true,
    onStart: fn(),
  },
  render: (args) => (
    <div className="max-w-3xl">
      <RatingGoalSection {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** Whether the squares of a headline are drawn, and how many. */
async function expectSquares(canvas: Canvas, count: number) {
  const squares = canvas.queryByRole('img', { name: /empty square/u })
  if (count === 0) {
    await expect(squares).toBeNull()
    return
  }
  await expect(squares).toHaveAccessibleName(
    `${count} empty squares, one for each new review still needed`,
  )
  await expect(squares?.children).toHaveLength(count)
}

/**
 * The round 5 card (D2/D4): the ladder, the new reviews to the next number with
 * a square for each, when the goal arrives, this week on its day, the first
 * step and the ways on. The title takes the focus back from the wizard.
 */
export const OnPace: Story = {
  args: { card: cardRead(CARD_HARBORLINE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 2, name: 'Google rating goal' })
    await expect(heading).toHaveAttribute('id', RATING_GOAL_HEADING_ID)
    heading.focus()
    await expect(heading).toHaveFocus()
    await expect(canvas.getByText('On pace')).toBeVisible()
    // Upright and across: one picture each, the same words (only one shows).
    await expect(
      canvas.getAllByRole('img', {
        name: 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1. 4.2 is possible after that.',
      }),
    ).toHaveLength(2)
    await expect(canvas.getByText(wholeText('18 new reviews to 4.1'))).toBeVisible()
    await expectSquares(canvas, 18)
    await expect(
      canvas.getByText('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.'),
    ).toBeVisible()
    await expect(canvas.getByText('4.2 is possible in about 4 months.')).toBeVisible()
    await expect(
      canvas.getByRole('progressbar', { name: 'New reviews this week' }),
    ).toHaveAttribute('aria-valuetext', '2 of 7 new reviews this week')
    await expect(canvas.getByText('2 of 7')).toBeVisible()
    await expect(canvas.getByText('It’s Tuesday')).toBeVisible()
    await expect(
      canvas.getByText('Google shows 4.0 now, up from 3.9 when you started.'),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating`,
    )
    await expect(canvas.getByRole('link', { name: 'Open Portals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals`,
    )
  },
}

/** 31 new reviews to 4.4 and 212 to the goal: past 30 the number stands alone. */
export const FarGoal: Story = {
  args: { card: cardRead(CARD_FAR_GOAL) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(wholeText('31 new reviews to 4.4'))).toBeVisible()
    await expect(canvas.getByText('212 new reviews to your goal, 4.5.')).toBeVisible()
    await expectSquares(canvas, 0)
    await expect(
      canvas.getByText(
        '4.5 in about 5 months at your pace of the last 4 weeks, likely 4–8 months.',
      ),
    ).toBeVisible()
  },
}

/** Five weeks in: the card works at the last four weeks' pace, and says so. */
export const ActualPace: Story = {
  args: { card: cardRead(CARD_ACTUAL_PACE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        '4.1 in about 3 weeks at your pace of the last 4 weeks, likely 2–4 weeks.',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText('It’s Tuesday · 1 a day over the last 4 weeks'),
    ).toBeVisible()
  },
}

export const JustSet: Story = {
  args: { card: cardRead(CARD_HARBORLINE_JUST_SET) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started')).toBeVisible()
    await expect(canvas.getByText(wholeText('19 new reviews to 4.0'))).toBeVisible()
    await expect(canvas.getByText('81 new reviews to your goal, 4.1.')).toBeVisible()
    await expect(canvas.getByText('Aim for about 1 new review a day')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

export const GettingStarted: Story = {
  args: { card: cardRead(CARD_GETTING_STARTED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started')).toBeVisible()
    await expectSquares(canvas, 12)
    await expect(canvas.queryByText(/up from/u)).toBeNull()
  },
}

/** RepKey holds fewer reviews than Google counts: every count is "about", no squares. */
export const ApproximateNumbers: Story = {
  args: { card: cardRead(CARD_GOOGLE_SOURCE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(wholeText('about 18 new reviews to 4.1'))).toBeVisible()
    await expectSquares(canvas, 0)
  },
}

export const BelowPace: Story = {
  args: {
    card: cardRead({ ...CARD_HARBORLINE, status: 'below_pace', thisWeekCount: 1 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Below pace')).toBeVisible()
    await expect(canvas.getByText('1 of 7')).toBeVisible()
  },
}

export const NewReviewsTooLow: Story = {
  args: { card: cardRead(CARD_TOO_LOW) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The chip names the target; the card says the notice's own words and what helps (R2-5, R2-10, R2-12).
    await expect(canvas.getByText('New reviews too low for 4.1')).toBeVisible()
    await expect(
      canvas.getByText(
        /^Since you set the goal, new reviews average below what 4\.1 needs\./u,
      ),
    ).toBeVisible()
    await expectSquares(canvas, 0)
    await expect(canvas.queryByText(/likely/u)).toBeNull()
  },
}

/** Google's numbers are two days old: its last number with its date, and why the goal waits. */
export const WaitingForGoogle: Story = {
  args: { card: cardRead(CARD_WAITING) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting for Google')).toBeVisible()
    await expect(canvas.getByText('as of Oct 12')).toBeVisible()
    // The headline dates the numbers; the sentence does not say it again.
    await expect(canvas.getByText('Waiting for Google’s latest numbers.')).toBeVisible()
    await expectSquares(canvas, 0)
  },
}

/** The cache clears the goal; Google still shows less. */
export const GoogleShowsSoon: Story = {
  args: { card: cardRead(CARD_LAGS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google should show 4.1 soon')).toBeVisible()
    await expectSquares(canvas, 0)
    await expect(canvas.queryByText(/likely/u)).toBeNull()
  },
}

/** Google lags on 4.4: the card counts to the goal of 4.5 and says 4.4 is coming. */
export const LagsMiddle: Story = {
  args: { card: cardRead(CARD_LAGS_MIDDLE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(wholeText('180 new reviews to 4.5'))).toBeVisible()
    await expect(canvas.getByText('Google should show 4.4 soon')).toBeVisible()
    await expect(canvas.queryByText(wholeText('0 new reviews to 4.4'))).toBeNull()
    await expect(
      canvas.getAllByRole('img', {
        name: 'Google shows 4.3 now. Google should show 4.4 soon. Your goal is 4.5.',
      }),
    ).toHaveLength(2)
  },
}

export const NoPace: Story = {
  args: { card: cardRead(CARD_NO_PACE) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'No new reviews in the last 4 weeks to work out when.',
      ),
    ).toBeVisible()
  },
}

/** 0.1★ less never reaches 4.1: the likely range is open. */
export const OpenSlowEnd: Story = {
  args: { card: cardRead(CARD_OPEN_SLOW) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        '4.1 in about 3 weeks at your 1 a day, likely 13 days or more.',
      ),
    ).toBeVisible()
  },
}

export const KeepHolding: Story = {
  args: { card: cardRead(CARD_KEEP) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Keeping 4.9 on Google')).toBeVisible()
    await expect(canvas.getByText('Holding')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvas.queryByText(/a week|new reviews|likely/u)).toBeNull()
  },
}

export const KeepDroppedBelow: Story = {
  args: {
    card: cardRead({
      ...CARD_KEEP,
      status: 'dropped_below',
      google: { ...CARD_KEEP.google!, shows: 4.8 },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Dropped below')).toBeVisible()
  },
}

/**
 * After a goal is reached: "Set your next goal" opens the setup. Keep is
 * offered from 4.7 (X1), so 4.5 has no "Keep 4.5".
 */
async function expectNextGoalDoors(canvas: Canvas, onStart: unknown) {
  await userEvent.click(canvas.getByRole('button', { name: 'Set your next goal' }))
  await expect(onStart).toHaveBeenCalledWith({ kind: 'climb' })
  await expect(canvas.queryByRole('button', { name: /^Keep/ })).toBeNull()
}

/** With no goal: the title, its sentence, and "Set goal", which opens the setup. */
async function expectPlanDoor(
  canvas: Canvas,
  onStart: unknown,
  description: string | RegExp,
) {
  await expect(canvas.getByText('Set your Google rating goal')).toBeVisible()
  await expect(canvas.getByText(description)).toBeVisible()
  await userEvent.click(canvas.getByRole('button', { name: 'Set goal' }))
  await expect(onStart).toHaveBeenCalledWith({ kind: 'climb' })
}

/** Reached: the day, then the next goal (the setup). */
export const Reached: Story = {
  args: { card: cardRead(CARD_REACHED) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Google shows 4.5 — goal reached on Oct 14'),
    ).toBeVisible()
    await expectNextGoalDoors(canvas, args.onStart)
  },
}

/** Reached at 4.9: nothing higher can be planned, so the one next step is to keep it. */
export const ReachedAtFourNine: Story = {
  args: {
    card: cardRead({
      ...CARD_REACHED,
      targetTenths: 49,
      target: 4.9,
      threshold: 4.85,
      google: { ...CARD_REACHED.google!, shows: 4.9 },
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Set your next goal' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Keep 4.9' }))
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'keep', targetTenths: 49 })
  },
}

/**
 * The read that found the goal reached returns it once; the next read has no
 * goal, and the news then comes from History, with the day it was reached.
 */
function ReadAgainHarness() {
  const [card, setCard] = useState<RatingGoalCardView | null>(CARD_REACHED)
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Button variant="outline" onClick={() => setCard(null)}>
        Read again
      </Button>
      <RatingGoalSection
        propertyId={FIXTURE_PROPERTY_ID}
        timezone={FIXTURE_TIMEZONE}
        now={NOW}
        card={cardRead(card)}
        setup={read(SETUP_SHOWS_45)}
        history={read([{ ...REACHED_LATELY, reachedAt: FIXTURE_NOW }])}
        hasPortals
        onStart={fn()}
      />
    </div>
  )
}

export const ReachedStaysAfterTheNextRead: Story = {
  render: () => <ReadAgainHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Google shows 4.5 — goal reached on Oct 14'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Read again' }))
    await expect(
      canvas.getByText('Google shows 4.5 — goal reached on Oct 14'),
    ).toBeVisible()
    await expect(canvas.queryByText('Set your Google rating goal')).toBeNull()
  },
}

/**
 * The usual way a goal is reached: the snapshot consumer reaches it before
 * anyone looks, so the card read has no goal and History has the news, with
 * the real day, the next goal and "Keep".
 */
export const ReachedBeforeAnyoneLooked: Story = {
  args: {
    card: cardRead(null),
    setup: read(SETUP_SHOWS_45),
    history: read([REACHED_LATELY, ...HISTORY]),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Google shows 4.5 — goal reached on Oct 12'),
    ).toBeVisible()
    await expect(canvas.queryByText('Set your Google rating goal')).toBeNull()
    await expectNextGoalDoors(canvas, args.onStart)
  },
}

/** Google slipped back under the target since: the news says what it shows now. */
export const ReachedThenSlipped: Story = {
  args: {
    card: cardRead(null),
    setup: read({ ...SETUP, google: { ...SETUP.google!, shows: 4.4 } }),
    history: read([REACHED_LATELY]),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'Goal reached on Oct 12: Google showed 4.5. It shows 4.4 now.',
      ),
    ).toBeVisible()
  },
}

/** Two weeks on, a reached goal is History, not news: the plain door is back. */
export const ReachedLongAgo: Story = {
  args: {
    card: cardRead(null),
    setup: read(SETUP),
    history: read([{ ...REACHED_LATELY, reachedAt: '2026-09-20T05:10:00.000Z' }]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set your Google rating goal')).toBeVisible()
    await expect(canvas.queryByText(/goal reached/)).toBeNull()
  },
}

/** A goal the manager ended is no news to them: the plain door. */
export const EndedByAManager: Story = {
  args: {
    card: cardRead(null),
    setup: read(SETUP),
    history: read([
      {
        ...REACHED_LATELY,
        state: 'ended',
        endedReason: 'manager',
        reachedAt: null,
        endedAt: '2026-10-13T09:00:00.000Z',
      },
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set your Google rating goal')).toBeVisible()
    await expect(canvas.queryByText(/^Ended/)).toBeNull()
  },
}

/** Archived: the news is told, and no new goal is offered to a Property that cannot have one. */
export const EndedByArchive: Story = {
  args: {
    card: cardRead(null),
    setup: read({
      ...SETUP,
      eligibility: { eligible: false, reason: 'property_not_active' },
    }),
    history: read([
      {
        ...REACHED_LATELY,
        state: 'ended',
        endedReason: 'property_archived',
        reachedAt: null,
        endedAt: '2026-10-13T09:00:00.000Z',
      },
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Ended: property archived. Your goal was 4.5 on Google.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** While History is still read, the section keeps its room rather than guess. */
export const ReadingHistory: Story = {
  args: { card: cardRead(null), setup: read(SETUP), history: read(undefined) },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('[data-slot="rating-goal-pending"]'),
    ).toBeInTheDocument()
  },
}

export const EndedByGoogleLocation: Story = {
  args: {
    card: cardRead({
      ...CARD,
      state: 'ended',
      endedReason: 'google_location_changed',
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Ended: Google location changed. Your goal was 4.5 on Google.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Set a new goal' }))
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'climb' })
  },
}

/** No goal yet: one sentence and one door into the wizard. */
export const SetYourGoal: Story = {
  args: { card: cardRead(null), setup: read(SETUP) },
  play: async ({ canvasElement, args }) => {
    await expectPlanDoor(
      within(canvasElement),
      args.onStart,
      /^Google shows 4\.3 from 812 reviews\./,
    )
  },
}

/**
 * The beta property (3.9 from 261, recent reviews under what 4.0 needs) is
 * offered a goal to raise it, never "keep it": Keep is first only from 4.7.
 */
export const LowRatingPicksAPlan: Story = {
  args: { card: cardRead(null), setup: read(SETUP_BETA) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/keep/i)).toBeNull()
    await expectPlanDoor(
      canvas,
      args.onStart,
      'Google shows 3.9 from 261 reviews. We suggest a number Google can show and how many new reviews a day get you there.',
    )
  },
}

/** Members can read goals they cannot set: the door is words, not a button. */
export const SetYourGoalReadOnly: Story = {
  args: { card: cardRead(null), setup: read(SETUP) },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Set goal' })).toBeNull()
    await expect(canvas.getByText('You can’t set goals for this property.')).toBeVisible()
  },
}

export const KeepFirst: Story = {
  args: { card: cardRead(null), setup: read(SETUP_KEEP_FIRST) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Keep 5.0 on Google' }))
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'keep', targetTenths: 50 })
    await expect(canvas.getByText(/There’s no higher number to aim for/)).toBeVisible()
  },
}

export const FewReviews: Story = {
  args: { card: cardRead(null), setup: read(SETUP_FEW_REVIEWS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Rating goals start at 10 Google reviews'),
    ).toBeVisible()
    // The count only: never a number of reviews to go and ask for.
    await expect(canvas.getByText('You have 6.')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to portals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals`,
    )
    await expect(canvas.queryByRole('button', { name: 'Set goal' })).toBeNull()
  },
}

/** No Portal yet: the link makes the first one, not an empty list. */
export const FewReviewsNoPortals: Story = {
  args: { card: cardRead(null), setup: read(SETUP_FEW_REVIEWS), hasPortals: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Create a portal' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals/new`,
    )
    await expect(canvas.queryByRole('link', { name: 'Go to portals' })).toBeNull()
  },
}

export const PropertyNotActive: Story = {
  args: {
    card: cardRead(null),
    setup: read({
      ...SETUP,
      eligibility: { eligible: false, reason: 'property_not_active' },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        'This property isn’t active, so it can’t have a Google rating goal.',
      ),
    ).toBeVisible()
  },
}

export const GoogleNumbersMissing: Story = {
  args: {
    card: cardRead(null),
    setup: read({
      ...SETUP,
      eligibility: { eligible: false, reason: 'waiting_for_google' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting for Google’s numbers')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'Check the Google connection' }),
    ).toBeVisible()
  },
}

export const Reading: Story = {
  args: { card: cardRead(undefined) },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('[data-slot="rating-goal-pending"]'),
    ).toBeInTheDocument()
  },
}

export const ReadFailed: Story = {
  args: { card: cardRead(undefined, true) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The Google rating goal couldn’t be loaded.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.card.retry).toHaveBeenCalledOnce()
  },
}

const PHONE = { viewport: { defaultViewport: 'mobileStaff' } } as const

export const OnPacePhone: Story = {
  ...OnPace,
  parameters: PHONE,
  play: async (context) => {
    await OnPace.play?.(context)
    // The card's ways on are button-shaped links: tap targets on a phone.
    const canvas = within(context.canvasElement)
    await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'data-slot',
      'button',
    )
  },
}
export const FarGoalPhone: Story = { ...FarGoal, parameters: PHONE }
export const ActualPacePhone: Story = { ...ActualPace, parameters: PHONE }
export const JustSetPhone: Story = { ...JustSet, parameters: PHONE }
export const ApproximateNumbersPhone: Story = { ...ApproximateNumbers, parameters: PHONE }
/** The long chip drops below the title on a phone instead of squeezing it. */
export const NewReviewsTooLowPhone: Story = { ...NewReviewsTooLow, parameters: PHONE }
export const WaitingForGooglePhone: Story = { ...WaitingForGoogle, parameters: PHONE }
export const GoogleShowsSoonPhone: Story = { ...GoogleShowsSoon, parameters: PHONE }
export const LagsMiddlePhone: Story = { ...LagsMiddle, parameters: PHONE }
export const NoPacePhone: Story = { ...NoPace, parameters: PHONE }
export const OpenSlowEndPhone: Story = { ...OpenSlowEnd, parameters: PHONE }

export const OnPaceLight: Story = { ...OnPace, parameters: { theme: 'light' } }
export const OnPacePhoneLight: Story = {
  ...OnPace,
  parameters: { ...PHONE, theme: 'light' },
}

/** The History view: reached and ended goals, their pace, dates and reason. */
export const History: Story = {
  render: () => (
    <div className="max-w-3xl">
      <RatingGoalHistory history={read(HISTORY)} timezone={FIXTURE_TIMEZONE} now={NOW} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Reach 4.3 on Google')).toBeVisible()
    await expect(canvas.getByText('1.3 a day · set Mar 2 · reached Jul 28')).toBeVisible()
    await expect(canvas.getByText('Keep 4.2 on Google')).toBeVisible()
    await expect(
      canvas.getByText('set Nov 10, 2025 · ended Feb 20 · Google location changed'),
    ).toBeVisible()
  },
}

export const HistoryEmpty: Story = {
  render: () => (
    <RatingGoalHistory history={read([])} timezone={FIXTURE_TIMEZONE} now={NOW} />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('No Google rating goal history'),
    ).toBeVisible()
  },
}
