// The Google rating goal's detail page of round 5 (PLAN-D D-2, mock D3): the
// headline with when the goal arrives, "The climb, step by step" (the exact
// average, the plan's cone and the likely band, in a lazy chart), "Your plan,
// so far" and "What moved you"; and its actions, which only a manager allowed
// to change or end a goal sees; the low reviews since the set, each linked to
// the Inbox item that opens it (D-2b). The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles and what the actions do, not
// pixels.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { tailwindIsCompiled } from '../../../.storybook/tailwind-compiled'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { RatingGoalDetail, RatingGoalMissing } from './rating-goal-detail'
import { RatingGoalDetailActions } from './rating-goal-detail-actions'
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
  DETAIL_LOW_REVIEWS,
  DETAIL_LOW_REVIEWS_WITHOUT_INBOX,
  DETAIL_SETBACK_NULL,
  LOW_REVIEW_ITEM_ONE,
  LOW_REVIEW_ITEM_TWO,
} from './rating-goal-low-reviews.stories.fixtures'
import { withRatingGoalRefusals } from './rating-goal-refusal'
import {
  DETAIL,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const NOW = new Date(FIXTURE_NOW)

/**
 * The chart's frame where Tailwind is not compiled (the Vitest story runner):
 * `h-60` is inert there, so recharts would measure no height and draw nothing.
 * The frame's 240 px stands in, so the plays can read the chart's own words.
 * Where Tailwind is compiled the classes decide and nothing stands in.
 */
const CHART_FRAME = `[data-slot='chart'] { display: flex; width: 100%; height: 240px; }`
const NAMES: Readonly<Record<string, string>> = { 'user-ana': 'Ana Petrova' }

const meta: Meta<typeof RatingGoalDetail> = {
  title: 'Goals/RatingGoalDetail',
  component: RatingGoalDetail,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <>
        {tailwindIsCompiled() ? null : <style>{CHART_FRAME}</style>}
        <Story />
      </>
    ),
  ],
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

/** The chart, from its own chunk (recharts can take a while on a loaded runner). */
const findChart = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole(
    'img',
    { name: 'The climb, step by step' },
    { timeout: 10_000 },
  )

/** The chart's caption, its reading and its accessible description. */
const caption = (canvasElement: HTMLElement) =>
  canvasElement.querySelector('figcaption')?.textContent ?? null

/** The climb's headline count ("18 new reviews to 4.1"), when the page shows one. */
const headlineCount = (canvasElement: HTMLElement) =>
  within(canvasElement).queryByText(
    (_, element) =>
      element?.tagName === 'P' &&
      /new reviews? to \d\.\d$/u.test(element.textContent ?? ''),
  )

/** The rows of "What moved you", as text. */
function movedRows(canvasElement: HTMLElement): string[] {
  const card = within(canvasElement)
    .getByRole('heading', { name: 'What moved you' })
    .closest('[data-slot="card"]')
  return [...(card?.querySelectorAll('li') ?? [])].map((row) => row.textContent ?? '')
}

/** Harborline twenty days in: every section, the climb drawn. */
export const Monitoring: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        (_, element) =>
          element?.tagName === 'P' && element.textContent === '18 new reviews to 4.1',
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        '4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks. Google shows 4.0 today, up from 3.9 when you started.',
      ),
    ).toBeVisible()
    await expect(canvas.getByText('4.2 is possible in about 3 months.')).toBeVisible()

    await expect(
      canvas.getByRole('heading', { name: 'The climb, step by step' }),
    ).toBeVisible()
    const key = within(canvas.getByRole('list', { name: 'Chart key' }))
    await expect(key.getByText('Google’s exact average')).toBeVisible()
    await expect(key.getByText('Your plan')).toBeVisible()
    await expect(key.getByText('Likely')).toBeVisible()
    const chart = await findChart(canvasElement)
    // Words, not a Tab stop: nothing inside the figure takes focus.
    await expect(chart.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull()
    await expect(chart.querySelector('[role="application"]')).toBeNull()
    await expect(within(chart).getByText('4.1 likely in 2–4 weeks')).toBeInTheDocument()
    await expect(
      within(chart).getByText('Your goal: Google shows 4.1 above this line'),
    ).toBeInTheDocument()
    await expect(caption(canvasElement)).toBe(
      'Google’s exact average went from 3.91 when you set the goal to 4.02 today. 4.1 is likely in 2–4 weeks.',
    )

    const plan = within(canvas.getByRole('region', { name: 'Your plan, so far' }))
    await expect(plan.getByText('1 a day · plan 1 a day')).toBeVisible()
    await expect(
      plan.getByText('Last 4 weeks · up from about 2 a month before the goal'),
    ).toBeVisible()
    await expect(plan.getByText('4.57★ · plan 4.5★')).toBeVisible()
    await expect(plan.getByText('4.0 reached · 4.1 next')).toBeVisible()
    await expect(plan.getByText('After 4.1: 4.2 is about 80 more')).toBeVisible()

    await expect(movedRows(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 8Google started showing 4.0',
      'Sep 24Ana Petrova set the goal: 4.1 at 1 a day',
    ])
    await expect(
      canvas.getByText(
        'Google numbers checked 12 minutes ago · Owners and managers only',
      ),
    ).toBeVisible()
  },
}

/** The links "What moved you" offers to the Inbox, by name. */
const inboxLinks = (canvasElement: HTMLElement) =>
  within(canvasElement).queryAllByRole('link', { name: /^Open in the inbox: /u })

/** Two low reviews since the set: what each set the goal back, opened in the Inbox. */
export const LowReviews: Story = {
  args: { detail: DETAIL_LOW_REVIEWS },
  play: async ({ canvasElement }) => {
    await expect(movedRows(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 121★ review · set you back about 8 new reviewsOpen in the inbox',
      'Oct 8Google started showing 4.0',
      'Oct 62★ review · set you back about 5 new reviewsOpen in the inbox',
      'Sep 24Ana Petrova set the goal: 4.1 at 1 a day',
    ])
    const [first, second] = inboxLinks(canvasElement)
    await expect(first).toHaveAccessibleName('Open in the inbox: the 1★ review of Oct 12')
    await expect(first).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/reviews?itemId=${LOW_REVIEW_ITEM_ONE}`,
    )
    await expect(second).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/reviews?itemId=${LOW_REVIEW_ITEM_TWO}`,
    )
    for (const link of inboxLinks(canvasElement)) {
      // The Inbox item opens the review; no review id ever reaches the page.
      await expect(link.getAttribute('href')).not.toContain('reviewId=')
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
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

/** A viewer the policy refuses the Inbox: the rows say the same, with no link. */
export const LowReviewWithoutInbox: Story = {
  args: { detail: DETAIL_LOW_REVIEWS_WITHOUT_INBOX },
  play: async ({ canvasElement }) => {
    await expect(movedRows(canvasElement)).toContain(
      'Oct 121★ review · set you back about 8 new reviews',
    )
    await expect(inboxLinks(canvasElement)).toEqual([])
  },
}

/** No low review since the set: no row and no link to the Inbox. */
export const NoLowReviews: Story = {
  play: async ({ canvasElement }) => {
    await expect(movedRows(canvasElement).some((row) => row.includes('★ review'))).toBe(
      false,
    )
    await expect(inboxLinks(canvasElement)).toEqual([])
  },
}

/** New reviews too low to reach 4.1: the review is named without a setback. */
export const SetbackNull: Story = {
  args: { detail: DETAIL_SETBACK_NULL },
  play: async ({ canvasElement }) => {
    await expect(movedRows(canvasElement)).toContain('Oct 121★ reviewOpen in the inbox')
    await expect(inboxLinks(canvasElement)).toHaveLength(1)
  },
}

export const MonitoringLight: Story = {
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expect(await findChart(canvasElement)).toBeInTheDocument()
  },
}

/** Google showed 4.0, then went back to 3.9: the warn-coloured dot and row, in both themes. */
export const WentBack: Story = {
  args: { detail: DETAIL_WENT_BACK },
  play: async ({ canvasElement }) => {
    const chart = await findChart(canvasElement)
    // Under today's words on the chart, so named in the list only.
    await expect(within(chart).queryByText('Back to 3.9')).toBeNull()
    await expect(movedRows(canvasElement)).toEqual([
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

/** The pace changed on 1 Oct: the cone starts at that week's Monday, the row says who. */
export const PlanChanged: Story = {
  args: { detail: DETAIL_PLAN_CHANGED },
  play: async ({ canvasElement }) => {
    await expect(await findChart(canvasElement)).toBeInTheDocument()
    await expect(movedRows(canvasElement)).toEqual([
      'This week2 new reviews, both 5★',
      'Oct 8Google started showing 4.0',
      'Oct 1Ana Petrova changed the plan: Pace 5 a week → 1 a day',
      'Sep 24Ana Petrova set the goal: 4.1 at 5 a week',
    ])
  },
}

/** RepKey holds fewer reviews than Google counts: no line yet, every count "about". */
export const GoogleSource: Story = {
  args: { detail: DETAIL_GOOGLE_SOURCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'RepKey doesn’t hold every review Google counts yet, so these numbers are approximate.',
      ),
    ).toBeVisible()
    await expect(await findChart(canvasElement)).toBeInTheDocument()
    await expect(caption(canvasElement)).toBe(
      'Your review cache is still filling, so Google’s exact average is not drawn yet. 4.1 is likely in 2–4 weeks.',
    )
    const key = within(canvas.getByRole('list', { name: 'Chart key' }))
    await expect(key.queryByText('Google’s exact average')).toBeNull()
    await expect(key.getByText('Your plan')).toBeVisible()
  },
}

/** The same with a changed plan: no history to start its cone from, so no cone. */
export const ChangedPartialCache: Story = {
  args: { detail: DETAIL_CHANGED_PARTIAL },
  play: async ({ canvasElement }) => {
    const key = within(within(canvasElement).getByRole('list', { name: 'Chart key' }))
    await expect(key.queryByText('Your plan')).toBeNull()
    await expect(key.getByText('Likely')).toBeVisible()
  },
}

/** Set 200 days ago: a year of history, the cone to today, nothing before the goal to compare. */
export const OldGoal: Story = {
  args: { detail: DETAIL_OLD_GOAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await findChart(canvasElement)).toBeInTheDocument()
    const plan = within(canvas.getByRole('region', { name: 'Your plan, so far' }))
    await expect(plan.getByText('Last 4 weeks')).toBeVisible()
    await expect(canvas.getByText(/^At your 1\.5 a day: in about /)).toBeVisible()
  },
}

/** New reviews too low for 4.1: said once with what helps, no time, no likely band. */
export const TooLow: Story = {
  args: { detail: DETAIL_TOO_LOW },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'Since you set the goal, new reviews average below what 4.1 needs.',
    )
    await expect(canvas.queryByText(/likely/u)).toBeNull()
    const key = within(canvas.getByRole('list', { name: 'Chart key' }))
    await expect(key.queryByText('Likely')).toBeNull()
  },
}

/** The cache clears 4.1 while Google shows 4.0: the headline says so, no time. */
export const Lags: Story = {
  args: { detail: DETAIL_LAGS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google should show 4.1 soon')).toBeVisible()
    await expect(
      canvas.getByText(/^Your reviews already clear 4\.1\. Google’s number can take/),
    ).toBeVisible()
    await expect(canvas.queryByText(/ in about /u)).toBeNull()
  },
}

/** Google lags on 4.4: 180 new reviews to the goal of 4.5, "Google should show 4.4 soon". */
export const LagsMiddle: Story = {
  args: { detail: DETAIL_LAGS_MIDDLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        (_, element) =>
          element?.tagName === 'P' && element.textContent === '180 new reviews to 4.5',
      ),
    ).toBeVisible()
    await expect(canvas.getByText('Google should show 4.4 soon')).toBeVisible()
    await expect(canvas.queryByText(/0 new reviews to 4\.4/u)).toBeNull()
  },
}

/** A goal to keep a number: its headline and what moved, no chart and no plan. */
export const KeepGoal: Story = {
  args: {
    detail: {
      ...DETAIL_HARBORLINE,
      mode: 'keep',
      targetTenths: 48,
      target: 4.8,
      threshold: 4.75,
      google: { ...DETAIL_HARBORLINE.google!, shows: 4.8 },
      qualityTenths: null,
      quality: null,
      qualityBasis: null,
      paceTenthsPerWeek: null,
      status: 'holding',
      next: null,
      stillNeeded: null,
      nextUp: null,
      forecast: null,
      forecastAtChosenPace: null,
      forecastAtActualPace: null,
      plan: null,
      chart: null,
      planSoFar: { prePlan: null, reachedTenths: null },
      moved: {
        ...DETAIL_HARBORLINE.moved,
        initialTargetTenths: 48,
        initialPaceTenthsPerWeek: null,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Google shows')).toBeVisible()
    await expect(
      canvas.queryByRole('heading', { name: 'The climb, step by step' }),
    ).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Your plan, so far' })).toBeNull()
    await expect(movedRows(canvasElement).at(-1)).toBe(
      'Sep 24Ana Petrova set the goal: keep 4.8',
    )
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
    await expect(canvas.getByText('as of Oct 12')).toBeVisible()
    await expect(canvas.getByText('Waiting for Google’s latest numbers.')).toBeVisible()
    await expect(
      canvas.getByText('Google numbers checked 2 days ago · Owners and managers only'),
    ).toBeVisible()
  },
}

/** Nothing that looks ahead: no count, no next step, no time, no likely band. */
async function looksAheadNoMore(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await expect(headlineCount(canvasElement)).toBeNull()
  await expect(canvas.queryByText(/ next$/u)).toBeNull()
  await expect(canvas.queryByText(/^After \d\.\d:/u)).toBeNull()
  await expect(canvas.queryByText(/ in about /u)).toBeNull()
  await expect(await findChart(canvasElement)).toBeInTheDocument()
  await expect(caption(canvasElement)).not.toMatch(/likely/u)
}

/** Found reached (the exact average 4.07, past the goal's line): said first, nothing that looks ahead. */
export const FoundReached: Story = {
  args: { detail: DETAIL_FOUND_REACHED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/^Google shows 4\.1: the goal is reached\./),
    ).toBeVisible()
    await looksAheadNoMore(canvasElement)
    // Today's dot stays inside the chart, above the goal's line.
    await expect(
      within(await findChart(canvasElement)).getByText('Today 4.07'),
    ).toBeInTheDocument()
  },
}

export const FoundEnded: Story = {
  args: { detail: DETAIL_FOUND_ENDED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/^Ended: Google location changed\. It is in History now/),
    ).toBeVisible()
    await looksAheadNoMore(canvasElement)
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
    const chart = within(await findChart(canvasElement))
    // A phone's short words: the line labels short, the band and dots left to the caption.
    await expect(chart.getByText('Goal 4.1')).toBeInTheDocument()
    await expect(chart.getByText('Plan set')).toBeInTheDocument()
    await expect(chart.queryByText('4.1 likely in 2–4 weeks')).toBeNull()
    await expect(chart.queryByText('Google shows 4.0')).toBeNull()
    // Ticks every 8 weeks.
    await expect(chart.getByText('In 8 weeks')).toBeInTheDocument()
    await expect(chart.queryByText('In 4 weeks')).toBeNull()
    await expect(
      within(canvasElement).getByText(
        'Last 4 weeks · up from about 2 a month before the goal',
      ),
    ).toBeVisible()
  },
}

export const PhoneLight: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' }, theme: 'light' },
  play: async ({ canvasElement }) => {
    await expect(await findChart(canvasElement)).toBeInTheDocument()
  },
}

const onChange = fn()
const onEnd = fn(async () => undefined)

/** A manager sees both actions; ending confirms first, in the destructive tone. */
export const Actions: StoryObj<typeof RatingGoalDetailActions> = {
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
export const EndRefused: StoryObj<typeof RatingGoalDetailActions> = {
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
export const ActionsHiddenWithoutPermission: StoryObj<typeof RatingGoalDetailActions> = {
  decorators: [withRole('Member')],
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
export const KeepGoalWithNothingHigher: StoryObj<typeof RatingGoalDetailActions> = {
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
