// The Google rating goal's detail page (2026-11-01, ADR 0067) in the states it can be
// in: the card that says where the goal stands, its ruler, then three bands as Guest
// voice and Portal Results draw theirs (is the rating going up, with a plain line to
// the goal; are enough good reviews coming in, with bars against the plan; what can
// you do this week), and "What happened", closed until asked. Also the low reviews
// since the set, each linked to the Inbox item that opens it (D-2b), and the actions
// only a manager allowed to change or end a goal sees are `rating-goal-detail-actions.stories.tsx`.
// The Storybook Vitest project compiles no Tailwind, so the plays assert words and
// roles, not pixels.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { RatingGoalDetail, RatingGoalMissing } from './rating-goal-detail'
import {
  DETAIL_CHANGED_PARTIAL,
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_LAGS_MIDDLE,
  DETAIL_OLD_GOAL,
  DETAIL_PLAN_CHANGED,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
  DETAIL_WENT_BACK,
} from './rating-goal-detail-outcomes.stories.fixtures'
import {
  DETAIL_BELOW_PACE,
  DETAIL_JUST_SET,
  DETAIL_KEEP,
} from './rating-goal-detail-states.stories.fixtures'
import {
  DETAIL_LOW_REVIEWS,
  DETAIL_LOW_REVIEWS_WITHOUT_INBOX,
  DETAIL_SETBACK_NULL,
  LOW_REVIEW_ITEM_ONE,
  LOW_REVIEW_ITEM_TWO,
} from './rating-goal-low-reviews.stories.fixtures'
import {
  bandOf,
  expectNoExactAverage,
  figureOf,
  QUESTION,
  readByKey,
  readoutsOf,
  whatHappened,
  whereOf,
} from './rating-goal-detail.stories.play'
import {
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
} from './rating-goal.stories.fixtures'
import { wholeText } from './rating-goal-wizard.stories.play'

const NOW = new Date(FIXTURE_NOW)
const NAMES: Readonly<Record<string, string>> = { 'user-ana': 'Ana Petrova' }

const meta: Meta<typeof RatingGoalDetail> = {
  title: 'Goals/RatingGoalDetail',
  component: RatingGoalDetail,
  parameters: { layout: 'padded' },
  args: {
    propertyId: FIXTURE_PROPERTY_ID,
    detail: DETAIL_HARBORLINE,
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

const PHONE = { viewport: { defaultViewport: 'mobileStaff' } } as const
const LINE = 'Your rating on Google'
const BARS = 'New reviews each week'
const ITEM_HREF = (item: string) =>
  `/properties/${FIXTURE_PROPERTY_ID}/reviews?itemId=${item}`

/** Harborline twenty days in: where it stands, the three bands, and what happened. */
export const Monitoring: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText(wholeText('18 new reviews to 4.1'))).toBeVisible()
    await expect(
      where.getByText('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.'),
    ).toBeVisible()
    await expect(
      where.getByRole('img', {
        name: 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
      }),
    ).toBeVisible()

    const rising = bandOf(canvas, QUESTION.rising)
    await expect(rising.getByText('Yes, from 3.9 to 4.0')).toBeVisible()
    await expect(rising.getByText('Google started showing 4.0 on Oct 8.')).toBeVisible()
    const line = figureOf(canvas, LINE)
    await expect(line).toBeVisible()
    await expect(
      within(line).getByText(
        'Google showed 3.9 when you set the goal and shows 4.0 today. 4.1 in about 3 weeks.',
      ),
    ).toBeInTheDocument()
    await expect(within(line).getByText('Goal set, Sep 24')).toBeInTheDocument()
    await expect(within(line).getByText('Today 4.0')).toBeInTheDocument()
    await expect(readoutsOf(line)).toHaveLength(9)
    await expect(readoutsOf(line).at(-1)).toBe('Today · Google shows 4.0')

    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(reviews.getByText('Yes, about 7 a week')).toBeVisible()
    await expect(
      reviews.getByText('You planned 1 a day. Before the goal it was about 2 a month.'),
    ).toBeVisible()
    const bars = figureOf(canvas, BARS)
    await expect(within(bars).getByText('Your plan: 7 a week')).toBeVisible()
    await expect(readoutsOf(bars).at(-1)).toBe('Week of Oct 12 · 2 new reviews so far')
    await expect(reviews.getByText('They average 4.6★. You planned 4.5★.')).toBeVisible()
    await expect(
      reviews.getByText('None of the 27 new reviews gave 3★ or less.'),
    ).toBeVisible()

    const week = bandOf(canvas, QUESTION.week)
    await expect(week.getByText('Keep asking every guest')).toBeVisible()
    await expect(
      week.getByText('2 new reviews so far this week. It’s Tuesday.'),
    ).toBeVisible()
    await expect(
      week.getByRole('link', { name: /^Ask every guest before they leave/u }),
    ).toHaveAttribute('href', `/properties/${FIXTURE_PROPERTY_ID}/portals`)

    await expect(await whatHappened(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 8Google started showing 4.0',
      'Sep 24Ana Petrova set the goal: 4.1 at 1 a day',
    ])
    await expect(
      canvas.getByText(
        'Google numbers checked 12 minutes ago · Owners and managers only',
      ),
    ).toBeVisible()
    await expectNoExactAverage(canvasElement)
  },
}

export const MonitoringLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expect(figureOf(within(canvasElement), LINE)).toBeVisible()
    await expect(figureOf(within(canvasElement), BARS)).toBeVisible()
  },
}

/** The line and the bars read point by point from the keyboard, as under a pointer. */
export const ReadByKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = figureOf(canvas, LINE)
    await expect(await readByKey(line, 'Home')).toBe('Aug 24 · Google showed 3.9')
    await expect(await readByKey(line, 'End')).toBe('Today · Google shows 4.0')
    await expect(await readByKey(line, 'ArrowLeft')).toBe('Oct 12 · Google showed 4.0')

    const bars = figureOf(canvas, BARS)
    await expect(await readByKey(bars, 'Home')).toBe('Week of Aug 24 · 0 new reviews')
    await expect(await readByKey(bars, 'End')).toBe(
      'Week of Oct 12 · 2 new reviews so far',
    )
    await expect(await readByKey(bars, 'ArrowLeft')).toBe(
      'Week of Oct 5 · 10 new reviews',
    )
  },
}

/** Each link to the Inbox, by name: the band's, the todo row's, and the rows of "What happened". */
const inboxLinks = (canvasElement: HTMLElement) =>
  within(canvasElement).queryAllByRole('link', { name: /inbox|^Read the \d★ review/u })

/** Two low reviews since the set: how many, what each set the goal back, opened in the Inbox. */
export const LowReviews: Story = {
  args: { detail: DETAIL_LOW_REVIEWS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(
      reviews.getByText(/^2 of the 27 new reviews gave 3★ or less\./u),
    ).toBeVisible()
    await expect(
      reviews.getByRole('link', { name: 'Open in the inbox' }),
    ).toHaveAttribute('href', ITEM_HREF(LOW_REVIEW_ITEM_ONE))

    const week = bandOf(canvas, QUESTION.week)
    const row = week.getByRole('link', { name: /^Read the 1★ review from Oct 12/u })
    await expect(row).toHaveAttribute('href', ITEM_HREF(LOW_REVIEW_ITEM_ONE))
    await expect(row).toHaveTextContent('It set you back about 8 new reviews.')

    await expect(await whatHappened(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 121★ review · set you back about 8 new reviewsOpen in the inbox',
      'Oct 8Google started showing 4.0',
      'Oct 62★ review · set you back about 5 new reviewsOpen in the inbox',
      'Sep 24Ana Petrova set the goal: 4.1 at 1 a day',
    ])
    const [first, second] = canvas.getAllByRole('link', { name: /^Open in the inbox: / })
    await expect(first).toHaveAccessibleName('Open in the inbox: the 1★ review of Oct 12')
    await expect(first).toHaveAttribute('href', ITEM_HREF(LOW_REVIEW_ITEM_ONE))
    await expect(second).toHaveAttribute('href', ITEM_HREF(LOW_REVIEW_ITEM_TWO))
    for (const link of inboxLinks(canvasElement)) {
      // The Inbox item opens the review; no review id ever reaches the page.
      await expect(link.getAttribute('href')).not.toContain('reviewId=')
    }
    for (const link of canvas.getAllByRole('link', { name: /^Open in the inbox: / })) {
      // Label in name (WCAG 2.5.3): saying the visible words finds the link.
      await expect(link.textContent).toBe('Open in the inbox')
      await expect(link.getAttribute('aria-label')).toContain(link.textContent)
    }
  },
}

export const LowReviewsLight: Story = {
  ...LowReviews,
  parameters: { theme: 'light' },
}

/** On a phone the link's touch target grows without moving its words off the date's line. */
export const LowReviewsPhone: Story = {
  ...LowReviews,
  parameters: PHONE,
}

/** A viewer the policy refuses the Inbox: the same words everywhere, with no link to it. */
export const LowReviewWithoutInbox: Story = {
  args: { detail: DETAIL_LOW_REVIEWS_WITHOUT_INBOX },
  play: async ({ canvasElement }) => {
    const reviews = bandOf(within(canvasElement), QUESTION.reviews)
    await expect(
      reviews.getByText('2 of the 27 new reviews gave 3★ or less.'),
    ).toBeVisible()
    await expect(await whatHappened(canvasElement)).toContain(
      'Oct 121★ review · set you back about 8 new reviews',
    )
    await expect(inboxLinks(canvasElement)).toEqual([])
  },
}

/** No low review since the set: it says none, and offers no link to the Inbox. */
export const NoLowReviews: Story = {
  play: async ({ canvasElement }) => {
    const reviews = bandOf(within(canvasElement), QUESTION.reviews)
    await expect(
      reviews.getByText('None of the 27 new reviews gave 3★ or less.'),
    ).toBeVisible()
    await expect(
      (await whatHappened(canvasElement)).some((row) => row.includes('★ review')),
    ).toBe(false)
    await expect(inboxLinks(canvasElement)).toEqual([])
  },
}

/** New reviews too low to reach 4.1: the review is named without a setback. */
export const SetbackNull: Story = {
  args: { detail: DETAIL_SETBACK_NULL },
  play: async ({ canvasElement }) => {
    const week = bandOf(within(canvasElement), QUESTION.week)
    const row = week.getByRole('link', { name: /^Read the 1★ review from Oct 12/u })
    await expect(row).not.toHaveTextContent('set you back')
    await expect(await whatHappened(canvasElement)).toContain(
      'Oct 121★ reviewOpen in the inbox',
    )
  },
}

/** Google showed 4.0, then went back to 3.9: said in the band, on the chart and in the rows. */
export const WentBack: Story = {
  args: { detail: DETAIL_WENT_BACK },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rising = bandOf(canvas, QUESTION.rising)
    await expect(rising.getByText('Not lately. Google went back to 3.9')).toBeVisible()
    await expect(
      rising.getByText('It went back on Oct 5. 1 new review to 4.0.'),
    ).toBeVisible()
    await expect(
      within(figureOf(canvas, LINE)).getByText('Back to 3.9, Oct 5'),
    ).toBeInTheDocument()
    await expect(await whatHappened(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 5Google went back to 3.9',
      'Sep 30Google started showing 4.0',
      'Sep 24Ana Petrova set the goal: 4.1 at 1 a day',
    ])
  },
}

export const WentBackLight: Story = {
  ...WentBack,
  parameters: { theme: 'light' },
}

/** The pace changed on 1 Oct: the rows say who and when; the line to the goal does not mark it. */
export const PlanChanged: Story = {
  args: { detail: DETAIL_PLAN_CHANGED },
  play: async ({ canvasElement }) => {
    await expect(figureOf(within(canvasElement), LINE)).toBeVisible()
    await expect(await whatHappened(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 8Google started showing 4.0',
      'Oct 1Ana Petrova changed the plan: Pace 5 a week → 1 a day',
      'Sep 24Ana Petrova set the goal: 4.1 at 5 a week',
    ])
  },
}

/** RepKey holds fewer reviews than Google counts: every count is "about", the line follows Google's number. */
export const GoogleSource: Story = {
  args: { detail: DETAIL_GOOGLE_SOURCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText(wholeText('About 18 new reviews to 4.1'))).toBeVisible()
    await expect(
      where.getByText(
        'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.',
      ),
    ).toBeVisible()
    const line = figureOf(canvas, LINE)
    await expect(
      within(line).getByText(
        /RepKey doesn’t hold every review yet, so this follows Google’s own number\./u,
      ),
    ).toBeInTheDocument()
    await expect(readoutsOf(line)[0]).toBe('Aug 24 · Google showed 3.9')
    await expect(readoutsOf(line).at(-1)).toBe('Today · Google shows 4.0')
    await expectNoExactAverage(canvasElement)
  },
}

/** The same with a changed plan: the line follows Google's number, and the rows say who changed it. */
export const ChangedPartialCache: Story = {
  args: { detail: DETAIL_CHANGED_PARTIAL },
  play: async ({ canvasElement }) => {
    const line = figureOf(within(canvasElement), LINE)
    await expect(readoutsOf(line).at(-1)).toBe('Today · Google shows 4.0')
    await expect(await whatHappened(canvasElement)).toContain(
      'Oct 1Ana Petrova changed the plan: Pace 5 a week → 1 a day',
    )
  },
}

/** Set 200 days ago: a year of line, the last 13 weeks of bars, nothing before the goal to compare. */
export const OldGoal: Story = {
  args: { detail: DETAIL_OLD_GOAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      whereOf(canvasElement).getByText(/^At your 1\.5 a day: in about /u),
    ).toBeVisible()
    await expect(readoutsOf(figureOf(canvas, LINE))).toHaveLength(53)
    const bars = readoutsOf(figureOf(canvas, BARS))
    await expect(bars).toHaveLength(13)
    await expect(bars[0]).toBe('Week of Jul 20 · 8 new reviews')
    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(reviews.getByText('Not enough: about 10 a week')).toBeVisible()
    await expect(reviews.getByText('You planned 11 a week.')).toBeVisible()
    await expect(canvas.queryByText(/Before the goal/u)).toBeNull()
  },
}

/** A goal behind its plan: both times, the weeks short of the line, and the way to change the plan. */
export const BelowPace: Story = {
  args: { detail: DETAIL_BELOW_PACE, onChangePlan: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(
      where.getByText(
        '4.1 in about 5 weeks at your pace of the last 4 weeks, likely 4–7 weeks.',
      ),
    ).toBeVisible()
    await expect(where.getByText('At your 1 a day: in about 3 weeks.')).toBeVisible()
    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(reviews.getByText('Not enough: about 4 a week')).toBeVisible()
    await expect(reviews.getByText('You planned 7 a week.')).toBeVisible()
    const week = bandOf(canvas, QUESTION.week)
    await expect(week.getByText('Ask more guests')).toBeVisible()
    await userEvent.click(week.getByRole('button', { name: /^Change the plan/u }))
    await expect(args.onChangePlan).toHaveBeenCalledOnce()
  },
}

/** Without the way to change the plan (a viewer who may not), the rows are the link alone. */
export const BelowPaceCannotChange: Story = {
  args: { detail: DETAIL_BELOW_PACE },
  play: async ({ canvasElement }) => {
    const week = bandOf(within(canvasElement), QUESTION.week)
    await expect(week.queryByRole('button')).toBeNull()
    await expect(
      week.getByRole('link', { name: /^Ask every guest before they leave/u }),
    ).toBeVisible()
  },
}

/** Set yesterday: Google has not moved, no review came in yet, and it is too early to say. */
export const JustSet: Story = {
  args: { detail: DETAIL_JUST_SET },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText(wholeText('19 new reviews to 4.0'))).toBeVisible()
    await expect(where.getByText('81 new reviews to your goal, 4.1.')).toBeVisible()
    await expect(
      where.getByText(
        '4.1 in about 3 months at your 1 a day, likely 9 weeks to 4 months.',
      ),
    ).toBeVisible()
    await expect(
      where.getByRole('img', { name: 'Google shows 3.9 now. Your goal is 4.1.' }),
    ).toBeVisible()
    const rising = bandOf(canvas, QUESTION.rising)
    await expect(rising.getByText('You’ve just started')).toBeVisible()
    await expect(
      rising.getByText('Google shows 3.9. New reviews take a few weeks to show there.'),
    ).toBeVisible()
    await expect(
      within(figureOf(canvas, LINE)).getByText('Goal set, Oct 13'),
    ).toBeInTheDocument()
    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(reviews.getByText('Too early to say')).toBeVisible()
    await expect(
      reviews.getByText('We’ll compare their stars with your 4.5★ after 10 new reviews.'),
    ).toBeVisible()
    await expect(readoutsOf(figureOf(canvas, BARS)).at(-1)).toBe(
      'Week of Oct 12 · 0 new reviews so far',
    )
    await expect(
      bandOf(canvas, QUESTION.week).getByText('Start asking every guest'),
    ).toBeVisible()
  },
}

/** New reviews too low for 4.1: said once with what helps, no time, no dotted line. */
export const TooLow: Story = {
  args: { detail: DETAIL_TOO_LOW },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      whereOf(canvasElement).getByText('New reviews are too low for 4.1'),
    ).toBeVisible()
    const rising = bandOf(canvas, QUESTION.rising)
    await expect(rising.getByText('Up to 4.0, but not on course for 4.1')).toBeVisible()
    await expect(
      rising.getByText(
        'Since you set the goal, new reviews average below what 4.1 needs.',
      ),
    ).toBeVisible()
    const reviews = bandOf(canvas, QUESTION.reviews)
    await expect(reviews.getByText('Enough, but the stars are low')).toBeVisible()
    await expect(reviews.getByText('They average 3.8★. You planned 4.5★.')).toBeVisible()
    const week = bandOf(canvas, QUESTION.week)
    await expect(week.getByText('Fix what guests complain about')).toBeVisible()
    await expect(
      week.getByRole('link', { name: /^See what to fix first/u }),
    ).toHaveAttribute('href', `/properties/${FIXTURE_PROPERTY_ID}/guests`)
    await expect(canvas.queryByText(/likely/u)).toBeNull()
    await expect(canvas.queryByText(/ in about /u)).toBeNull()
  },
}

/** The cache clears 4.1 while Google shows 4.0: the headline says so, no time. */
export const Lags: Story = {
  args: { detail: DETAIL_LAGS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      whereOf(canvasElement).getByText('Google should show 4.1 soon'),
    ).toBeVisible()
    const rising = bandOf(canvas, QUESTION.rising)
    await expect(rising.getByText('Yes. Google should show 4.1 soon')).toBeVisible()
    await expect(
      rising.getByText(/^Your reviews already clear 4\.1\. Google’s number can take/u),
    ).toBeVisible()
    await expect(canvas.queryByText(/ in about /u)).toBeNull()
  },
}

/** Google lags on 4.4: 180 new reviews to the goal of 4.5, "Google should show 4.4 soon". */
export const LagsMiddle: Story = {
  args: { detail: DETAIL_LAGS_MIDDLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText(wholeText('180 new reviews to 4.5'))).toBeVisible()
    await expect(where.getByText('Google should show 4.4 soon')).toBeVisible()
    await expect(canvas.queryByText(wholeText('0 new reviews to 4.4'))).toBeNull()
    // Far past the line's own length: the dotted line runs off the chart, with an arrow.
    await expect(
      within(figureOf(canvas, LINE)).getByText('4.5 in about 6 months →'),
    ).toBeInTheDocument()
  },
}

/** A goal to keep a number: one question and this week's reviews, no line, no bars, no ruler. */
export const KeepGoal: Story = {
  args: { detail: DETAIL_KEEP },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Keeping 4.8 on Google')).toBeVisible()
    const holding = bandOf(canvas, 'Is it holding?')
    await expect(holding.getByText('Yes. Google shows 4.8')).toBeVisible()
    await expect(
      canvas.getByRole('region', { name: 'Is it holding?' }),
    ).toHaveTextContent('This week: 2 new reviews, both 5★')
    await expect(canvas.queryByRole('figure')).toBeNull()
    await expect(canvas.queryByRole('img')).toBeNull()
    await expect(canvas.queryByRole('region', { name: QUESTION.rising })).toBeNull()
    await expect((await whatHappened(canvasElement)).at(-1)).toBe(
      'Sep 24Ana Petrova set the goal: keep 4.8',
    )
  },
}

/** Google shows less than the number being kept: said plainly, with what moves it. */
export const KeepGoalDroppedBelow: Story = {
  args: {
    detail: {
      ...DETAIL_KEEP,
      status: 'dropped_below',
      google: { ...DETAIL_KEEP.google!, shows: 4.7 },
    },
  },
  play: async ({ canvasElement }) => {
    const holding = bandOf(within(canvasElement), 'Is it holding?')
    await expect(holding.getByText('Not right now. Google shows 4.7')).toBeVisible()
    await expect(
      holding.getByText(/^You’re keeping 4\.8\. Asking every guest/u),
    ).toBeVisible()
  },
}

/** Google's numbers are two days old: the last number with its date, and why it waits. */
export const WaitingForGoogle: Story = {
  args: {
    detail: {
      ...DETAIL_HARBORLINE,
      status: 'waiting_for_google',
      google: {
        ...DETAIL_HARBORLINE.google!,
        current: false,
        asOf: '2026-10-12T08:00:00.000Z',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText('as of Oct 12')).toBeVisible()
    await expect(where.getByText('Waiting for Google’s latest numbers.')).toBeVisible()
    await expect(
      where.getByRole('img', {
        name: 'Started at 3.9. Google showed 4.0 last. Your goal is 4.1.',
      }),
    ).toBeVisible()
    await expect(
      bandOf(canvas, QUESTION.rising).getByText('Waiting for Google’s latest numbers'),
    ).toBeVisible()
    await expect(within(figureOf(canvas, LINE)).getByText('Last 4.0')).toBeInTheDocument()
    await expect(
      canvas.getByText('Google numbers checked 2 days ago · Owners and managers only'),
    ).toBeVisible()
  },
}

/** Found reached (the exact average past the goal's line): said first, nothing that looks ahead. */
export const FoundReached: Story = {
  args: { detail: DETAIL_FOUND_REACHED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(where.getByText('Google shows 4.1. You did it.')).toBeVisible()
    await expect(
      where.getByRole('img', { name: 'Started at 3.9. Reached 4.1.' }),
    ).toBeVisible()
    const rising = bandOf(canvas, 'Did you get there?')
    await expect(rising.getByText('Yes. Google shows 4.1')).toBeVisible()
    await expect(rising.getByText('From 3.9 in 3 weeks.')).toBeVisible()
    const reviews = bandOf(canvas, 'What got you there?')
    await expect(reviews.getByText('27 new reviews at 4.6★')).toBeVisible()
    const next = bandOf(canvas, 'What’s next?')
    await expect(next.getByText('Set your next goal')).toBeVisible()
    await expect(next.getByRole('link', { name: /^Go to your goals/u })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals`,
    )
    await expect(canvas.queryByText(/ in about /u)).toBeNull()
    await expect(canvas.queryByText(/likely/u)).toBeNull()
    // Today's dot stays inside the chart, above the goal's line.
    await expect(
      within(figureOf(canvas, LINE)).getByText('Today 4.1'),
    ).toBeInTheDocument()
  },
}

export const FoundReachedLight: Story = {
  ...FoundReached,
  parameters: { theme: 'light' },
}

/** Found ended: said first, how it went, and no card of where it stands. */
export const FoundEnded: Story = {
  args: { detail: DETAIL_FOUND_ENDED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/^Ended: Google location changed\. It is in History now/u),
    ).toBeVisible()
    await expect(canvasElement.querySelector('[data-slot="goal-where"]')).toBeNull()
    const rising = bandOf(canvas, 'Where did it get to?')
    await expect(rising.getByText('Google shows 4.0')).toBeVisible()
    await expect(canvas.queryByRole('region', { name: QUESTION.reviews })).toBeNull()
    await expect(canvas.queryByRole('region', { name: QUESTION.week })).toBeNull()
    await expect(
      bandOf(canvas, 'What’s next?').getByText('Set your next goal'),
    ).toBeVisible()
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

/** On a phone the bands stack under the card; every figure is still named and every question asked. */
export const Phone: Story = {
  parameters: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      whereOf(canvasElement).getByRole('img', {
        name: 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
      }),
    ).toBeVisible()
    for (const question of Object.values(QUESTION)) {
      await expect(canvas.getByRole('region', { name: question })).toBeVisible()
    }
    await expect(figureOf(canvas, LINE)).toBeVisible()
    await expect(figureOf(canvas, BARS)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'What happened' })).toBeVisible()
  },
}

export const PhoneLight: Story = {
  parameters: { ...PHONE, theme: 'light' },
  play: Phone.play,
}

/** On the narrowest phone the same page, the same words. */
export const PhoneNarrow: Story = {
  ...Phone,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}
