// The Google rating goal on the Property Overview in each state it can be in:
// the simple card of an active goal, a goal reached lately, the one-line prompt
// into the wizard (to climb, or to keep the number when nothing higher is in
// reach), and nothing at all (too few Google reviews, "Not now" chosen, a viewer
// who may not set goals, a read on its way or failed). The Storybook Vitest project compiles no
// Tailwind, so the plays assert words, roles and what each door opens.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { RatingGoalOverview } from './rating-goal-overview'
import {
  CARD,
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
    card: CARD,
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

/** The same simple card as the Goals page: two numbers, one bar, one pace line. */
export const ActiveGoal: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      `/properties/${FIXTURE_PROPERTY_ID}/goals/google-rating`,
    )
    await expect(card.getByText('This week: 6 of 11 reviews')).toBeVisible()
    await expect(card.queryByRole('button', { name: /Set your Google/ })).toBeNull()
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
