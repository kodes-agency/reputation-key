// The Google section of the Goals page in every state it can be in: the simple
// card of an active goal (each status, and a goal to keep), the goal a read just
// found reached or ended, the door into the wizard, the "keep" door, the reasons
// there is no goal yet, a read on its way or failed, and a reader who cannot set
// goals. The Storybook Vitest project compiles no Tailwind, so the plays assert
// words, roles and what each door opens, not pixels.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { Button } from '#/components/ui/button'
import { RatingGoalHistory } from './rating-goal-history'
import { RatingGoalSection } from './rating-goal-section'
import {
  CARD,
  CARD_JUST_SET,
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
import type { RatingGoalCardView } from '#/contexts/reporting/application/dto/rating-goal.types'

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

/** The simple card leads with two numbers and says nothing else. */
export const OnPace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Google rating goal' }),
    ).toBeVisible()
    await expect(canvas.getByText('On pace')).toBeVisible()
    await expect(canvas.getByText('Google shows')).toBeVisible()
    await expect(canvas.getByText('4.3')).toBeVisible()
    await expect(canvas.getByText('4.5')).toBeVisible()
    const bar = canvas.getByRole('progressbar', {
      name: 'Progress toward Google showing 4.5',
    })
    await expect(bar).toHaveAttribute('aria-valuetext', 'Exact average 4.38 of 4.45')
    await expect(canvas.getByText('This week: 6 of 11 reviews')).toBeVisible()
    await expect(canvas.getByText('Expected around Jul–Sep 2027')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating`,
    )
  },
}

export const JustSet: Story = {
  args: { card: cardRead(CARD_JUST_SET) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started')).toBeVisible()
    await expect(canvas.getByText('Aim for about 11 new reviews a week')).toBeVisible()
    await expect(canvas.getByText('Expected around Apr 2027 – Apr 2028')).toBeVisible()
  },
}

export const BelowPace: Story = {
  args: { card: cardRead({ ...CARD, status: 'below_pace', thisWeekCount: 2 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Below pace')).toBeVisible()
    await expect(canvas.getByText('This week: 2 of 11 reviews')).toBeVisible()
  },
}

export const CantReachAtThisMix: Story = {
  args: {
    card: cardRead({
      ...CARD,
      status: 'cant_reach_at_mix',
      forecast: { kind: 'unreachable' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Can’t reach at this mix')).toBeVisible()
    await expect(
      canvas.getByText(
        'No pace reaches 4.5 at the recent star mix. A lower goal can still be reached.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByText(/^Expected around/)).toBeNull()
  },
}

/** Google's numbers are a day old: its last number with its date, and why the goal waits. */
export const WaitingForGoogle: Story = {
  args: {
    card: cardRead({
      ...CARD,
      status: 'waiting_for_google',
      google: { ...CARD.google!, current: false, asOf: '2026-10-12T08:00:00.000Z' },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting for Google')).toBeVisible()
    await expect(canvas.getByText('as of Oct 12')).toBeVisible()
    await expect(
      canvas.getByText(
        /^Waiting for Google’s latest numbers\. These are from Oct 12, 2026/,
      ),
    ).toBeVisible()
  },
}

export const GoogleShowsSoon: Story = {
  args: { card: cardRead({ ...CARD, googleShowsSoon: true, progress: 1 }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Google should show 4.5 soon'),
    ).toBeVisible()
  },
}

export const KeepHolding: Story = {
  args: { card: cardRead(CARD_KEEP) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Keeping 4.3 on Google')).toBeVisible()
    await expect(canvas.getByText('Holding')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvas.queryByText(/a week/)).toBeNull()
    await expect(canvas.queryByText(/^Expected around/)).toBeNull()
  },
}

export const KeepDroppedBelow: Story = {
  args: {
    card: cardRead({
      ...CARD_KEEP,
      status: 'dropped_below',
      google: { ...CARD_KEEP.google!, shows: 4.2 },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Dropped below')).toBeVisible()
  },
}

/** Reached: the day, the next tenth preselected, or keep the number. */
export const Reached: Story = {
  args: { card: cardRead(CARD_REACHED) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Google shows 4.5 — goal reached on Oct 14'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Set your next goal' }))
    await expect(args.onStart).toHaveBeenCalledWith({
      kind: 'climb',
      preselectTenths: 46,
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Keep 4.5' }))
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'keep', targetTenths: 45 })
  },
}

/** The read that found the goal reached returns it once; the section keeps the news on screen. */
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
        setup={read(SETUP)}
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
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Set your Google rating goal')).toBeVisible()
    await expect(canvas.getByText(/^Google shows 4\.3 from 812 reviews\./)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Set goal' }))
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'climb' })
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
    await expect(canvas.getByText(/^You have 6\./)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to portals' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/portals`,
    )
    await expect(canvas.queryByRole('button', { name: 'Set goal' })).toBeNull()
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

export const OnPacePhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('This week: 6 of 11 reviews'),
    ).toBeVisible()
  },
}

export const OnPaceLight: Story = { parameters: { theme: 'light' } }

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
    await expect(canvas.getByText('9 a week · set Mar 2 · reached Jul 28')).toBeVisible()
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
