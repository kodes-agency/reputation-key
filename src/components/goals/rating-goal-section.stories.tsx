// The Google section of the Goals page, with the simple card of an active goal in each
// state it can be in (2026-11-01, ADR 0067): what is left to the next number, when the
// goal arrives, the ruler of how far along it is, this week against the plan and the
// way to the detail, and nothing else. The doors, the outcomes and the History view
// are `rating-goal-section-doors.stories.tsx`. The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles and what each card links to, not pixels.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { RatingGoalSection } from './rating-goal-section'
import { RATING_GOAL_HEADING_ID } from './rating-goal-card-header'
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
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
} from './rating-goal.stories.fixtures'
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'
import { expectNoExactAverage } from './rating-goal-detail.stories.play'
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
  // As wide as the Goals page draws it, so the card reaches its two columns.
  render: (args) => (
    <div className="max-w-5xl">
      <RatingGoalSection {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

const PHONE = { viewport: { defaultViewport: 'mobileStaff' } } as const

/** The headline, its figure in a span of its own, and the line under it. */
async function expectHeadline(canvas: Canvas, headline: string, line: string) {
  await expect(canvas.getByText(wholeText(headline))).toBeVisible()
  await expect(canvas.getByText(line)).toBeVisible()
}

/** The one picture on the card is the ruler, named by its sentence. */
async function expectRuler(canvas: Canvas, sentence: string) {
  await expect(canvas.getAllByRole('img')).toHaveLength(1)
  await expect(canvas.getByRole('img', { name: sentence })).toBeVisible()
}

/**
 * What the card draws at every width: the title (which takes the focus back from
 * the wizard), the chip, the ruler and the headline. Nothing is for a wide card alone.
 */
async function expectOnPaceClimb(canvas: Canvas) {
  const heading = canvas.getByRole('heading', { level: 2, name: 'Google rating goal' })
  await expect(heading).toHaveAttribute('id', RATING_GOAL_HEADING_ID)
  heading.focus()
  await expect(heading).toHaveFocus()
  await expect(canvas.getByText('On pace')).toBeVisible()
  await expectRuler(canvas, 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
  await expect(canvas.getByText(wholeText('18 new reviews to 4.1'))).toBeVisible()
}

export const OnPace: Story = {
  args: { card: cardRead(CARD_HARBORLINE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectOnPaceClimb(canvas)
    await expect(
      canvas.getByText('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.'),
    ).toBeVisible()
    // The ruler says the way: Google's numbers on it, the tenth passed marked reached.
    await expect(canvas.getByText('started')).toBeVisible()
    await expect(canvas.getByText('reached')).toBeVisible()
    await expect(canvas.getByText('your goal')).toBeVisible()
    await expect(
      canvas.getByRole('progressbar', { name: 'New reviews this week' }),
    ).toHaveAttribute('aria-valuetext', '2 of 7 new reviews this week')
    await expect(canvas.getByText('2 of 7')).toBeVisible()
    await expect(canvas.getByText('It’s Tuesday')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating`,
    )
    // The way on is the detail, and nothing else.
    await expect(canvas.getAllByRole('link')).toHaveLength(1)
    await expect(canvas.queryByText(/is possible/u)).toBeNull()
    await expectNoExactAverage(canvasElement)
  },
}

/** 31 new reviews to 4.4 and 212 to the goal. */
export const FarGoal: Story = {
  args: { card: cardRead(CARD_FAR_GOAL) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectHeadline(
      canvas,
      '31 new reviews to 4.4',
      '212 new reviews to your goal, 4.5.',
    )
    await expectRuler(canvas, 'Google shows 4.3 now. Your goal is 4.5.')
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

/** Set yesterday: the aim a day for this week, and a ruler that has not begun to fill. */
export const JustSet: Story = {
  args: { card: cardRead(CARD_HARBORLINE_JUST_SET) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started')).toBeVisible()
    await expectHeadline(
      canvas,
      '19 new reviews to 4.0',
      '81 new reviews to your goal, 4.1.',
    )
    await expect(canvas.getByText('Aim for about 1 new review a day')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    // The setup's receipt, word for word (R4-4).
    await expect(
      canvas.getByText(
        '4.1 in about 3 months at your 1 a day, likely 9 weeks to 4 months.',
      ),
    ).toBeVisible()
    await expectRuler(canvas, 'Google shows 3.9 now. Your goal is 4.1.')
    await expect(canvas.getByText('19 new reviews')).toBeVisible()
    await expect(canvas.queryByText(/is possible/u)).toBeNull()
  },
}

export const GettingStarted: Story = {
  args: { card: cardRead(CARD_GETTING_STARTED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started')).toBeVisible()
    await expectRuler(canvas, 'Google shows 3.9 now. Your goal is 4.1.')
    await expect(canvas.queryByText(/up from/u)).toBeNull()
  },
}

/** RepKey holds fewer reviews than Google counts: every count is "about". */
export const ApproximateNumbers: Story = {
  args: { card: cardRead(CARD_GOOGLE_SOURCE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(wholeText('About 18 new reviews to 4.1'))).toBeVisible()
    await expectRuler(canvas, 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
    await expectNoExactAverage(canvasElement)
  },
}

/** Fewer new reviews than the plan: the one pill, and the week short of its number. */
export const BelowPace: Story = {
  args: {
    card: cardRead({ ...CARD_HARBORLINE, status: 'below_pace', thisWeekCount: 1 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Below pace')).toBeVisible()
    await expect(canvas.getByText('1 of 7')).toBeVisible()
    await expect(
      canvas.getByRole('progressbar', { name: 'New reviews this week' }),
    ).toHaveAttribute('data-tone', 'neutral')
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
    await expectRuler(canvas, 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
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
    // Stale numbers are not "now": the ruler says what Google showed last.
    await expectRuler(canvas, 'Started at 3.9. Google showed 4.0 last. Your goal is 4.1.')
  },
}

/** The cache clears the goal; Google still shows less: the ruler is full, the time is not given. */
export const GoogleShowsSoon: Story = {
  args: { card: cardRead(CARD_LAGS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google should show 4.1 soon')).toBeVisible()
    await expectRuler(canvas, 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
    await expect(canvas.queryByText(/likely/u)).toBeNull()
  },
}

/** Google lags on 4.4: the card counts to the goal of 4.5 and says 4.4 is coming. */
export const LagsMiddle: Story = {
  args: { card: cardRead(CARD_LAGS_MIDDLE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectHeadline(canvas, '180 new reviews to 4.5', 'Google should show 4.4 soon')
    await expect(canvas.queryByText(wholeText('0 new reviews to 4.4'))).toBeNull()
    await expectRuler(canvas, 'Google shows 4.3 now. Your goal is 4.5.')
    await expect(
      canvas.getByText('4.5 in about 6 months at your 1 a day, likely 4–11 months.'),
    ).toBeVisible()
    await expect(canvas.queryByText(/is possible/u)).toBeNull()
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
        '4.1 in about 3 weeks at your 1 a day, likely 14 days or more.',
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
    await expect(canvas.queryByRole('img')).toBeNull()
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
 * A phone draws the same card, its side under its story: the ruler (its stops are
 * named by Google's numbers, its end note stays), then this week, then the way on.
 * The card's way on is a button-shaped link: a tap target on a phone.
 */
export const OnPacePhone: Story = {
  ...OnPace,
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectOnPaceClimb(canvas)
    await expect(canvas.getByText('It’s Tuesday')).toBeVisible()
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

/** On the narrowest phone the ruler's end note and the stop's words still have their room. */
export const OnPaceNarrowPhone: Story = {
  ...OnPace,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const OnPaceLight: Story = { ...OnPace, parameters: { theme: 'light' } }
export const OnPacePhoneLight: Story = {
  ...OnPacePhone,
  parameters: { ...PHONE, theme: 'light' },
}
