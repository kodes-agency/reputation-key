// The running Monthly portal goal on its card (PLAN PG-12; ADR 0068 amended
// 2026-10-19 and 2026-11-01): the shared card frame with the pace pill in its corner
// (Getting started, On pace, Below pace, or none for a month the rule does not
// judge), what is left to the number as the headline with the days left and what a
// day takes under it, the month so far on the ruler with a steady month's stop, what
// each Portal brought in (in name order, one Portal, five, and Other portals), the
// first quiet days, the last day, a goal passed, a figure that cannot be read, a
// stopped goal (with its way to the next goal), the month before while it is read and
// once it closed, and "View details" to the goal's page. Each at 320, 390, 820 and
// 1440 px and on the light theme where the layout changes. The Storybook Vitest
// project compiles no Tailwind, so the plays assert words, roles and the ruler's
// sentence (its words are in it); where Tailwind is compiled they also measure that
// nothing scrolls sideways.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PortalGoalSection } from './portal-goal-section'
import { SEAVIEW } from './portal-goal.stories.fixtures'
import {
  CARD_CHANGED_TO_SCANS,
  CARD_FIRST_DAYS,
  CARD_FIVE_PORTALS,
  CARD_LAST_DAY,
  CARD_LAST_MONTH_MET,
  CARD_LAST_MONTH_NOT_MET,
  CARD_LAST_MONTH_UPDATING,
  CARD_NOT_JUDGED,
  CARD_ON_PACE,
  CARD_ONE_PORTAL,
  CARD_OTHER_PORTALS,
  CARD_PASSED,
  CARD_RUNNING,
  CARD_STOPPED,
  CARD_STOPPED_NO_DATE,
  CARD_UNREADABLE,
} from './portal-goal-running.stories.fixtures'
import { headlineOf, portalRows } from './portal-goal.stories.play'

const read = (data: PortalGoalCardView) => ({
  data,
  failed: false,
  retrying: false,
  retry: fn(),
})

const meta: Meta<typeof PortalGoalSection> = {
  title: 'Goals/PortalGoalCardRunning',
  component: PortalGoalSection,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    card: read(CARD_RUNNING),
    canCreatePortal: true,
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn() },
  },
  // As wide as the Goals page draws the section.
  render: (args) => (
    <div className="max-w-5xl">
      <PortalGoalSection {...args} />
    </div>
  ),
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** The ruler's sentence on Nov 22: 23 of 40, and where a steady month would be today. */
const RULER =
  '23 of 40 private ratings so far. A steady month would be at about 29 by today.'

/** The ruler is a picture named by one sentence; its words are in it. */
const rulerOf = (canvas: Canvas, name: string) => canvas.getByRole('img', { name })

/** The card is no wider than the screen: the ruler and its words stay inside it. */
async function expectNoSidewaysScroll(canvasElement: HTMLElement) {
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
}

async function expectRunning(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
  await expect(
    canvas.getByText('How many private ratings your portals bring in each month.'),
  ).toBeVisible()
  // Behind: the pill in the corner says so, and nothing else does.
  await expect(canvas.getByText('Below pace', { exact: true })).toBeVisible()
  await expect(canvas.queryByText(/on pace/iu)).toBeNull()
  // What is left, led by its figure, with the days left and what a day takes under it.
  await expect(headlineOf(canvas, '17 private ratings to 40')).toBeVisible()
  await expect(
    canvas.getByText('9 days left in November. About 2 a day gets you there.'),
  ).toBeVisible()
  // The month so far on the ruler: from none to the number, with a steady month's stop.
  const ruler = rulerOf(canvas, RULER)
  await expect(ruler).toBeVisible()
  // A narrow ruler leaves out the end's note where the stop's words reach it: drawn, not always seen.
  for (const words of [
    '0',
    'Nov 1',
    '29',
    'steady pace',
    '40',
    'your number',
    '23 so far',
  ]) {
    await expect(within(ruler).getByText(words, { exact: true })).toBeInTheDocument()
  }
  await expect(canvas.queryByRole('progressbar')).toBeNull()
  await expectNoSidewaysScroll(canvasElement)
  // Name order, even with Spa on 20 and Reception on 3.
  await expect(portalRows(canvas)).toEqual([
    ['Reception', '3'],
    ['Restaurant', '0'],
    ['Spa', '20'],
  ])
  // Nothing to press on the card yet: the way on is the goal's page, a link.
  await expect(canvas.queryByRole('button')).toBeNull()
  await expect(canvas.getByRole('link', { name: 'View details' })).toHaveAttribute(
    'href',
    '/properties/p1/goals/portals',
  )
}

/** Nov 22: 23 of 40, 9 days left, below pace, and each Portal in name order. */
export const Running: Story = {
  play: async ({ canvasElement }) => expectRunning(within(canvasElement), canvasElement),
}

export const RunningPhone: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const Running320: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const RunningOnATablet: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const RunningOnADesktop: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const RunningLight: Story = {
  ...Running,
  parameters: { theme: 'light' },
}

/** Nov 22: 30 of 40, on the way: the pill says On pace, and the month stands past the steady stop. */
export const OnPace: Story = {
  args: { card: read(CARD_ON_PACE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('On pace', { exact: true })).toBeVisible()
    await expect(canvas.queryByText(/below pace|getting started/iu)).toBeNull()
    await expect(headlineOf(canvas, '10 private ratings to 40')).toBeVisible()
    const ruler = rulerOf(
      canvas,
      '30 of 40 private ratings so far. A steady month would be at about 29 by today.',
    )
    await expect(within(ruler).getByText('30 so far')).toBeVisible()
  },
}

/** A goal of 4 on Nov 29: too few expected to judge, so no pill, and the ruler still says where a steady month stands. */
export const NotJudged: Story = {
  args: { card: read(CARD_NOT_JUDGED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(headlineOf(canvas, '3 private ratings to 4')).toBeVisible()
    await expect(
      canvas.getByText('2 days left in November. About 2 a day gets you there.'),
    ).toBeVisible()
    await expect(canvas.queryByText(/pace|getting started/iu)).toBeNull()
    await expect(
      rulerOf(
        canvas,
        '1 of 4 private ratings so far. A steady month would be at about 4 by today.',
      ),
    ).toBeVisible()
  },
}

/** Nov 2: the first days are never judged: "Getting started", and no steady stop on the ruler. */
export const FirstDays: Story = {
  args: { card: read(CARD_FIRST_DAYS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Getting started', { exact: true })).toBeVisible()
    await expect(canvas.queryByText(/below pace/iu)).toBeNull()
    await expect(headlineOf(canvas, '39 private ratings to 40')).toBeVisible()
    await expect(
      canvas.getByText('29 days left in November. About 1 a day gets you there.'),
    ).toBeVisible()
    const ruler = rulerOf(canvas, '1 of 40 private ratings so far.')
    await expect(within(ruler).getByText('1 so far')).toBeVisible()
    await expect(within(ruler).queryByText('steady pace')).toBeNull()
  },
}

/** Nov 30: today is the last day. */
export const LastDay: Story = {
  args: { card: read(CARD_LAST_DAY) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Last day of November')).toBeVisible()
    await expect(headlineOf(canvas, '17 private ratings to 40')).toBeVisible()
    // A steady month is at the number today: the end of the ruler says it, so the stop has no words.
    const ruler = rulerOf(
      canvas,
      '23 of 40 private ratings so far. A steady month would be at about 40 by today.',
    )
    await expect(within(ruler).queryByText('steady pace')).toBeNull()
    await expectNoSidewaysScroll(canvasElement)
  },
}

export const LastDayOnANarrowPhone: Story = {
  ...LastDay,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/**
 * Nov 27: 41 of 40, passed with 4 days left: "On pace" in green, a headline
 * that says so, a full ruler with no steady stop, no celebration.
 */
export const Passed: Story = {
  args: { card: read(CARD_PASSED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('On pace', { exact: true })).toBeVisible()
    await expect(headlineOf(canvas, 'Goal passed: 41 private ratings')).toBeVisible()
    // Nothing left to get, so no word of what a day takes.
    await expect(
      canvas.getByText('4 days left in November', { exact: true }),
    ).toBeVisible()
    await expect(canvas.queryByText(/a day gets you there/u)).toBeNull()
    // A count past its number fills the ruler and no more.
    const ruler = rulerOf(canvas, '41 of 40 private ratings so far.')
    await expect(within(ruler).queryByText('steady pace')).toBeNull()
    await expect(canvas.queryByText(/to go/u)).toBeNull()
  },
}

export const PassedOnANarrowPhone: Story = {
  ...Passed,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/**
 * Changed on Nov 20 to scans from December: November still counts private
 * ratings, and says so, whatever the goal counts next.
 */
export const ChangedToScans: Story = {
  args: { card: read(CARD_CHANGED_TO_SCANS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(headlineOf(canvas, '17 private ratings to 40')).toBeVisible()
    await expect(rulerOf(canvas, RULER)).toBeVisible()
    await expect(canvas.queryByText(/\bscans\b/u)).toBeNull()
  },
}

/** The figure cannot be read: it says so, with no bar and never a zero. */
export const Unreadable: Story = {
  args: { card: read(CARD_UNREADABLE) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('November · 40 private ratings')).toBeVisible()
    await expect(
      canvas.getByText('This month’s figure can’t be read right now.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('img')).toBeNull()
    await expect(canvas.queryByText(/\b0 of\b/u)).toBeNull()
    // Nothing is judged without a figure: no pill, no headline.
    await expect(canvas.queryByText(/pace|getting started/iu)).toBeNull()
    await expect(canvas.queryByText(/ to 40$/u)).toBeNull()
    await expect(canvas.queryByRole('list', { name: 'From your portals' })).toBeNull()
    // No ruler to put in a column of its own, so the card is one column of
    // lines, and the way on is still the goal's page, under them.
    await expect(canvasElement.querySelector('[data-slot="goal-ruler"]')).toBeNull()
    const details = canvas.getByRole('link', { name: 'View details' })
    await expect(details).toHaveAttribute('href', '/properties/p1/goals/portals')
    // Not alone in a side column behind a divider, next to the lines.
    await expect(details.closest('[class~="@3xl:border-l"]')).toBeNull()
  },
}

/** One Portal brought in all of it: no rows, one sentence. */
export const OnePortal: Story = {
  args: { card: read(CARD_ONE_PORTAL) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('All from Reception.')).toBeVisible()
    await expect(canvas.queryByRole('list', { name: 'From your portals' })).toBeNull()
  },
}

/** From 5 Portals the card says how many; each is on the goal's page. */
export const FivePortals: Story = {
  args: { card: read(CARD_FIVE_PORTALS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/^From 5 portals/u)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See each' })).toHaveAttribute(
      'href',
      '/properties/p1/goals/portals#from-your-portals',
    )
    await expect(canvas.queryByRole('list', { name: 'From your portals' })).toBeNull()
  },
}

/** What a disabled Portal brought in is under Other portals, last. */
export const OtherPortals: Story = {
  args: { card: read(CARD_OTHER_PORTALS) },
  play: async ({ canvasElement }) => {
    await expect(portalRows(within(canvasElement))).toEqual([
      ['Reception', '13'],
      ['Restaurant', '6'],
      ['Spa', '2'],
      ['Other portals', '2'],
    ])
  },
}

export const OtherPortalsOnANarrowPhone: Story = {
  ...OtherPortals,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Stopped on Nov 12: November still counts, with its figure and rows. */
export const Stopped: Story = {
  args: { card: read(CARD_STOPPED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Stopped on Nov 12. November still counts to Nov 30.'),
    ).toBeVisible()
    await expect(headlineOf(canvas, '17 private ratings to 40')).toBeVisible()
    await expect(rulerOf(canvas, RULER)).toBeVisible()
  },
}

/** Where the page draws the sheet, the next goal can be set from December (PLAN PG-14). */
export const StoppedSetsTheNextGoal: Story = {
  args: {
    card: read(CARD_STOPPED),
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn(), openSheet: fn() },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Stopped on Nov 12. November still counts to Nov 30.'),
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Set a goal from December' }),
    )
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      measure: 'portal_rating_count',
      month: '2026-12',
    })
  },
}

export const StoppedOnANarrowPhone: Story = {
  ...Stopped,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Stopped before the day was recorded. */
export const StoppedNoDate: Story = {
  args: { card: read(CARD_STOPPED_NO_DATE) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Stopped. November still counts to Nov 30.'),
    ).toBeVisible()
  },
}

/** Dec 1: December has begun, and November's last ratings are still counted. */
export const LastMonthUpdating: Story = {
  args: { card: read(CARD_LAST_MONTH_UPDATING) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(rulerOf(canvas, '0 of 40 private ratings so far.')).toBeVisible()
    await expect(
      canvas.getByText('November: counting the last ratings. Final figure on Dec 2.'),
    ).toBeVisible()
    // December's first days are not judged: Getting started, never Below pace.
    await expect(canvas.getByText('Getting started', { exact: true })).toBeVisible()
    await expect(canvas.queryByText(/below pace/iu)).toBeNull()
  },
}

export const LastMonthUpdatingOnANarrowPhone: Story = {
  ...LastMonthUpdating,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Dec 3: November was met, with a check. */
export const LastMonthMet: Story = {
  args: { card: read(CARD_LAST_MONTH_MET) },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText('November met: 41 of 40')
    await expect(line).toBeVisible()
    await expect(line.parentElement?.querySelector('svg')).not.toBeNull()
  },
}

export const LastMonthMetLight: Story = {
  ...LastMonthMet,
  parameters: { theme: 'light' },
}

/** Dec 3: November was not met, said in neutral words and with no mark. */
export const LastMonthNotMet: Story = {
  args: { card: read(CARD_LAST_MONTH_NOT_MET) },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByText('November: 36 of 40 · not met')
    await expect(line).toBeVisible()
    await expect(line.parentElement?.querySelector('svg')).toBeNull()
  },
}
