// The running Monthly portal goal on its card (PLAN PG-12): the month so far
// with its bar and today's tick, what is left to go with the days left and
// "below pace" only when the read says so, what each Portal brought in (in
// name order, one Portal, five, and Other portals), the first quiet days, the
// last day, a goal passed, a figure that cannot be read, a stopped goal, and
// the month before while it is read and once it closed, and "View details" to
// the goal's page. Each at 320, 390, 820
// and 1440 px and on the light theme where the layout changes. The Storybook
// Vitest project compiles no Tailwind, so the plays assert words, roles, the
// tick's place and the bar's own clip on x (inline style, so it holds there
// too); where Tailwind is compiled they also measure that nothing scrolls
// sideways.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
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
  CARD_ONE_PORTAL,
  CARD_OTHER_PORTALS,
  CARD_PASSED,
  CARD_RUNNING,
  CARD_STOPPED,
  CARD_STOPPED_NO_DATE,
  CARD_UNREADABLE,
} from './portal-goal-running.stories.fixtures'

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

const BAR_LABEL = 'Private ratings in November'

/** The tick's layer, when one is drawn. */
const tickOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-slot="portal-goal-bar-tick"]')

/**
 * The tick's layer hangs past the bar's end by the tick's share of the bar:
 * the bar clips it at its sides only, so the page never scrolls sideways and
 * the tick still stands above and below the track.
 */
async function expectNoSidewaysScroll(canvasElement: HTMLElement) {
  const bar = canvasElement.querySelector<HTMLElement>('[data-slot="portal-goal-bar"]')
  if (!bar) throw new Error('expected the bar')
  await expect(getComputedStyle(bar).overflowX).toBe('clip')
  await expect(getComputedStyle(bar).overflowY).toBe('visible')
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
}

/** Each row of "From your portals", name and count, in the order drawn. */
function portalRows(canvas: Canvas): string[][] {
  const list = canvas.getByRole('list', { name: 'From your portals' })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => [...item.children].map((part) => part.textContent ?? ''))
}

async function expectRunning(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(
    canvas.getByRole('heading', { level: 3, name: 'Monthly portal goal' }),
  ).toBeVisible()
  await expect(
    canvas.getByText('How many private ratings your portals bring in each month.'),
  ).toBeVisible()
  await expect(canvas.getByText('23 of 40')).toBeVisible()
  await expect(canvas.getByText('private ratings')).toBeVisible()
  await expect(canvas.getByText('17 to go · 9 days left')).toBeVisible()
  await expect(canvas.getByText('below pace')).toBeVisible()
  const bar = canvas.getByRole('progressbar', { name: BAR_LABEL })
  await expect(bar).toHaveAttribute(
    'aria-valuetext',
    '23 of 40 private ratings, 9 days left, below pace',
  )
  await expect(bar).toHaveAttribute('aria-valuenow', '23')
  await expect(bar).toHaveAttribute('aria-valuemax', '40')
  // The tick: 22 of 30 days gone.
  await expect(tickOf(canvasElement)?.style.transform).toMatch(
    /^translateX\(73\.3+\d*%\)$/u,
  )
  await expectNoSidewaysScroll(canvasElement)
  // Name order, even with Spa on 20 and Reception on 3.
  await expect(portalRows(canvas)).toEqual([
    ['Reception', '3'],
    ['Restaurant', '0'],
    ['Spa', '20'],
  ])
  // Never a verdict in green, and nothing to press on the card yet: the way
  // on is the goal's page.
  await expect(canvas.queryByText(/on pace/u)).toBeNull()
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

/** Nov 2: the first days are never judged, so no pace word and no tick. */
export const FirstDays: Story = {
  args: { card: read(CARD_FIRST_DAYS) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 of 40')).toBeVisible()
    await expect(canvas.getByText('39 to go · 29 days left')).toBeVisible()
    await expect(canvas.queryByText('below pace')).toBeNull()
    await expect(canvas.getByRole('progressbar', { name: BAR_LABEL })).toHaveAttribute(
      'aria-valuetext',
      '1 of 40 private ratings, 29 days left',
    )
    await expect(tickOf(canvasElement)).toBeNull()
  },
}

/** Nov 30: today is the last day. */
export const LastDay: Story = {
  args: { card: read(CARD_LAST_DAY) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('17 to go · last day')).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: BAR_LABEL })).toHaveAttribute(
      'aria-valuetext',
      '23 of 40 private ratings, last day, below pace',
    )
    await expect(tickOf(canvasElement)?.style.transform).toBe('translateX(100%)')
    await expectNoSidewaysScroll(canvasElement)
  },
}

export const LastDayOnANarrowPhone: Story = {
  ...LastDay,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

/** Nov 27: 41 of 40, passed with 4 days left: a full bar, no tick, no celebration. */
export const Passed: Story = {
  args: { card: read(CARD_PASSED) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('41 of 40')).toBeVisible()
    await expect(canvas.getByText('Goal passed · 4 days left')).toBeVisible()
    const bar = canvas.getByRole('progressbar', { name: BAR_LABEL })
    await expect(bar).toHaveAttribute(
      'aria-valuetext',
      '41 of 40 private ratings, goal passed, 4 days left',
    )
    // A count past its number fills the bar and no more.
    await expect(bar).toHaveAttribute('aria-valuenow', '40')
    await expect(tickOf(canvasElement)).toBeNull()
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
    await expect(canvas.getByText('23 of 40')).toBeVisible()
    await expect(canvas.getByText('private ratings')).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: BAR_LABEL })).toHaveAttribute(
      'aria-valuetext',
      '23 of 40 private ratings, 9 days left, below pace',
    )
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
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvas.queryByText(/\b0 of\b/u)).toBeNull()
    await expect(canvas.queryByRole('list', { name: 'From your portals' })).toBeNull()
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
    await expect(canvas.getByText('23 of 40')).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: BAR_LABEL })).toBeVisible()
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
    await expect(canvas.getByText('0 of 40')).toBeVisible()
    await expect(
      canvas.getByRole('progressbar', { name: 'Private ratings in December' }),
    ).toBeVisible()
    await expect(
      canvas.getByText('November: counting the last ratings. Final figure on Dec 2.'),
    ).toBeVisible()
    // December's first days are not judged.
    await expect(canvas.queryByText('below pace')).toBeNull()
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
