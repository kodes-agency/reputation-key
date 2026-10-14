// The Google rating goal's detail page, the full monitoring view: both
// forecasts and the best case, the bar from the start with the next tenth, the
// three tiles, the weekly bars against the pace, the star mix, the change log
// and the foot; and its actions, which only a manager allowed to change or end
// a goal sees. The Storybook Vitest project compiles no Tailwind, so the plays
// assert words, roles and what the actions do, not pixels.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { RatingGoalDetail } from './rating-goal-detail'
import { RatingGoalDetailActions } from './rating-goal-detail-actions'
import {
  DETAIL,
  FIXTURE_NOW,
  FIXTURE_TIMEZONE,
  SETUP,
  SETUP_KEEP_FIRST,
} from './rating-goal.stories.fixtures'

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
    setup: SETUP,
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

export const Monitoring: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Reach 4.5 on Google' }),
    ).toBeVisible()
    await expect(
      canvas.getByText('Your pace: 11 a week · 48 a month · 1.6 a day'),
    ).toBeVisible()
    await expect(canvas.getByText('At your chosen pace, 11 a week')).toBeVisible()
    await expect(canvas.getByText('Expected around Mar–Nov 2027')).toBeVisible()
    await expect(
      canvas.getByText('At your pace of the last 4 weeks, 9.5 a week'),
    ).toBeVisible()
    await expect(canvas.getByText('Expected around Jul–Sep 2027')).toBeVisible()
    await expect(
      canvas.getByText(
        'If every new review is 5★: 97 more reviews, about 2 months at 11 a week.',
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
    await expect(tiles.getByText('9.5 a week')).toBeVisible()
    await expect(tiles.getByText('212 reviews')).toBeVisible()

    await expect(
      canvas.getByText('107 reviews since the goal was set · average 4.61★'),
    ).toBeVisible()
    await expect(canvas.getByText('Pace 14 → 11 a week')).toBeVisible()
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

export const KeepGoal: Story = {
  args: {
    detail: {
      ...DETAIL,
      mode: 'keep',
      targetTenths: 43,
      target: 4.3,
      pacePerWeek: null,
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
      canvas.getByRole('heading', { name: 'Keeping 4.3 on Google' }),
    ).toBeVisible()
    await expect(canvas.queryByText(/^Your pace/)).toBeNull()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvasElement.querySelector('[data-slot="metric-strip"]')).toBeNull()
    await expect(canvas.getByText('No changes since the goal was set.')).toBeVisible()
  },
}

export const CantReachSuggestsAFix: Story = {
  args: {
    detail: {
      ...DETAIL,
      status: 'cant_reach_at_mix',
      stillNeeded: null,
      forecastAtChosenPace: { kind: 'unreachable' },
      forecastAtActualPace: { kind: 'unreachable' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'No pace reaches 4.5 at the recent star mix. The highest goal you can reach now is 4.7.',
    )
    await expect(canvas.getByText('Not reachable')).toBeVisible()
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

export const FoundReached: Story = {
  args: { detail: { ...DETAIL, state: 'reached', status: 'reached' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/^Google shows 4\.5: the goal is reached\./),
    ).toBeVisible()
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
    await userEvent.click(canvas.getByRole('button', { name: 'Change target or pace' }))
    await expect(onChange).toHaveBeenCalledOnce()

    await userEvent.click(canvas.getByRole('button', { name: 'End goal' }))
    const dialog = within(await within(document.body).findByRole('alertdialog'))
    await expect(dialog.getByText('End the Google rating goal?')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'End goal' }))
    await waitFor(() => expect(onEnd).toHaveBeenCalledOnce())
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

/** A goal to keep changes only to a higher number the setup offers. */
export const KeepGoalWithNothingHigher: StoryObj<typeof RatingGoalDetailActions> = {
  render: () => (
    <div className="flex gap-2">
      <RatingGoalDetailActions
        goal={{ ...DETAIL, mode: 'keep', pacePerWeek: null }}
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
