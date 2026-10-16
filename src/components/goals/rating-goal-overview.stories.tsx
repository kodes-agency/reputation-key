// The Google rating goal on the Property Overview in each state it can be in:
// the card of an active goal (round 5, D4), a goal reached lately, the one-line prompt
// into the wizard (to climb, or to keep the number when nothing higher is in
// reach), and nothing at all (too few Google reviews, "Not now" chosen, a viewer
// who may not set goals, a read on its way or failed). The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles and what each door opens.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { RatingGoalOverview } from './rating-goal-overview'
import {
  CARD_FAR_GOAL,
  CARD_HARBORLINE,
  CARD_LAGS_MIDDLE,
} from './rating-goal-tracking.stories.fixtures'
import {
  CARD_REACHED,
  FIXTURE_NOW,
  FIXTURE_PROPERTY_ID,
  FIXTURE_TIMEZONE,
  SETUP,
  SETUP_FEW_REVIEWS,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

const NOW = new Date(FIXTURE_NOW)

const meta: Meta<typeof RatingGoalOverview> = {
  title: 'Goals/RatingGoalOverview',
  component: RatingGoalOverview,
  parameters: { layout: 'padded' },
  args: {
    propertyId: FIXTURE_PROPERTY_ID,
    timezone: FIXTURE_TIMEZONE,
    now: NOW,
    card: CARD_HARBORLINE,
    cardReadAt: NOW,
    setup: undefined,
    history: undefined,
    notNowChosen: false,
    onStart: fn(),
  },
  render: (args) => (
    <div className="max-w-5xl">
      <RatingGoalOverview {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>

/** Presses the one-line prompt, the Overview's door into the wizard. */
async function pressPrompt(canvasElement: HTMLElement) {
  const prompt = within(canvasElement).getByRole('button', {
    name: 'Set your Google rating goal',
  })
  await userEvent.click(prompt)
}

/** The words of an element, which may be split across spans (a figure in its own). */
const words = (text: string) => (_content: string, element: Element | null) =>
  element?.textContent === text &&
  Array.from(element.children).every((child) => child.textContent !== text)

/** Harborline's headline and its 18 squares, drawn at every width. */
async function expectHeadlineAndSquares(card: ReturnType<typeof within>) {
  await expect(card.getByText(words('18 new reviews to 4.1'))).toBeVisible()
  await expect(
    card.getByRole('img', {
      name: '18 empty squares, one for each new review still needed',
    }),
  ).toBeVisible()
}

/** The same card as the Goals page (D4): the ladder, the new reviews to the next number, this week. */
export const ActiveGoal: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(
      card.getByRole('heading', { level: 2, name: 'Google rating goal' }),
    ).toBeVisible()
    await expectHeadlineAndSquares(card)
    await expect(card.getByText('2 of 7')).toBeVisible()
    await expect(
      card.getByText('4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.'),
    ).toBeVisible()
    await expect(card.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating`,
    )
    await expect(card.queryByRole('button', { name: /Set your Google/ })).toBeNull()
  },
}

/**
 * The Overview on a phone: the card's own container draws D4's short card, so
 * this week and when are one line and the rest waits for the wide card.
 */
export const ActiveGoalPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expectHeadlineAndSquares(card)
    await expect(card.getByText('This week 2 of 7 · 4.1 in about 3 weeks')).toBeVisible()
    await expect(card.getByRole('link', { name: 'View details' })).toBeVisible()
  },
}

export const ActiveGoalLight: Story = { ...ActiveGoal, parameters: { theme: 'light' } }

/** A far goal: 31 to 4.4 and the goal's own total, no squares. */
export const FarGoal: Story = {
  args: { card: CARD_FAR_GOAL },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText(words('31 new reviews to 4.4'))).toBeVisible()
    await expect(card.getByText('212 new reviews to your goal, 4.5.')).toBeVisible()
    await expect(card.queryByRole('img', { name: /empty square/u })).toBeNull()
  },
}

/** Google lags on 4.4: the card counts to 4.5 and says 4.4 is coming. */
export const LagsMiddle: Story = {
  args: { card: CARD_LAGS_MIDDLE },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText(words('180 new reviews to 4.5'))).toBeVisible()
    await expect(card.getByText('Google should show 4.4 soon')).toBeVisible()
  },
}

/** No goal: one line, and it opens the wizard to climb. */
export const Prompt: Story = {
  args: { card: null, setup: SETUP, history: [] },
  play: async ({ canvasElement, args }) => {
    await pressPrompt(canvasElement)
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'climb' })
    // One line: no numbers, no card.
    await expect(within(canvasElement).queryByText('Google shows')).toBeNull()
  },
}

/** Nothing higher is in reach (Google shows 5.0): the line opens on keeping it. */
export const PromptToKeep: Story = {
  args: { card: null, setup: SETUP_KEEP_FIRST, history: [] },
  play: async ({ canvasElement, args }) => {
    await pressPrompt(canvasElement)
    await expect(args.onStart).toHaveBeenCalledWith({ kind: 'keep', targetTenths: 50 })
  },
}

/** A goal the card read found reached: the news, and what comes next. */
export const Reached: Story = {
  args: { card: CARD_REACHED, setup: SETUP, history: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Reached')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Set your next goal' })).toBeVisible()
  },
}

/** Fewer than ten Google reviews: the Overview says nothing about a goal. */
export const TooFewReviews: Story = {
  args: { card: null, setup: SETUP_FEW_REVIEWS, history: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toBe('')
  },
}

/** A manager chose "Not now" in the setup strip: the Overview stops asking. */
export const AfterNotNow: Story = {
  args: { card: null, setup: SETUP, history: [], notNowChosen: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toBe('')
  },
}

/** A viewer who may not set goals gets no prompt. */
export const CannotSetGoals: Story = {
  args: { card: null, setup: SETUP, history: [] },
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', {
        name: 'Set your Google rating goal',
      }),
    ).toBeNull()
  },
}

/** A read on its way, or failed: nothing, and the Overview is not held back. */
export const NotReadYet: Story = {
  args: { card: undefined },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toBe('')
  },
}
