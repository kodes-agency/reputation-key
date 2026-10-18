// The Monthly portal goal's page (PLAN PG-13): Seaview Hotel's goal on Nov 22,
// the mock's day (its tiles, November so far with the month's first and last
// day, each Portal's count in name order with the total, each month, what
// changed and how it counts); set and not yet begun; a quiet Portal; December
// with November and October closed (each month's facts on its chip); a
// corrected month; scans; one Portal; across a stop; stopped; many changes;
// no goal yet, where the page is the card's own state; and no goal after a
// stop, with that goal's months and changes. At 320, 390, 820 and 1440 px and on
// the light theme. The Storybook Vitest project compiles no Tailwind, so the
// plays assert words, roles, the heading outline and the calls.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { PortalGoalPage } from './portal-goal-page'
import {
  PAGE_ACROSS_A_STOP,
  PAGE_CORRECTED,
  PAGE_LATER,
  PAGE_MANY_CHANGES,
  PAGE_NO_GOAL,
  PAGE_NO_GOAL_AFTER_A_STOP,
  PAGE_ONE_PORTAL,
  PAGE_RUNNING,
  PAGE_SCANS,
  PAGE_SCHEDULED,
  PAGE_STOPPED,
  PAGE_WITH_NO_SCAN_FACTS,
  SEAVIEW,
  personName,
} from './portal-goal-page.stories.fixtures'
import { portalRows } from './portal-goal.stories.play'

const meta: Meta<typeof PortalGoalPage> = {
  title: 'Goals/PortalGoalPage',
  component: PortalGoalPage,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    page: PAGE_RUNNING,
    canCreatePortal: true,
    canSeeResults: true,
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn() },
    personName,
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** The page's headings, in document order, as "h2 Changes". */
const outline = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )

/** The tiles: a description list named after the goal. */
function tilesOf(canvasElement: HTMLElement): Canvas {
  const strip = canvasElement.querySelector<HTMLElement>('[data-slot="metric-strip"]')
  if (!strip) throw new Error('expected the tiles')
  return within(strip)
}

/** Each chip of "Month by month", by its name. */
function chipNames(canvas: Canvas): (string | null)[] {
  const strip = within(canvas.getByRole('list', { name: 'Month by month' }))
  return strip.getAllByRole('button').map((chip) => chip.getAttribute('aria-label'))
}

/** Each line of "Changes", as the page reads it out. */
function changeTexts(canvas: Canvas): string[] {
  const section = canvas.getByRole('region', { name: 'Changes' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

async function expectRunning(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(outline(canvasElement)).toEqual([
    'h1 Monthly portal goal',
    'h2 November so far',
    'h2 From your portals',
    'h2 Month by month',
    'h2 Changes',
    'h2 More portal goals',
  ])
  await expect(
    canvas.getByText('Private ratings from all 3 portals at Seaview Hotel.'),
  ).toBeVisible()
  const trail = within(canvas.getByRole('navigation', { name: 'breadcrumb' }))
  await expect(trail.getByRole('link', { name: 'Goals' })).toHaveAttribute(
    'href',
    '/properties/p1/goals',
  )
  // The tiles: November so far, October before the goal, the usual.
  const tiles = tilesOf(canvasElement)
  await expect(tiles.getByText('November')).toBeVisible()
  await expect(tiles.getByText('23 of 40')).toBeVisible()
  await expect(tiles.getByText('17 to go · 9 days left')).toBeVisible()
  await expect(tiles.getByText('October')).toBeVisible()
  await expect(tiles.getByText('No goal yet')).toBeVisible()
  await expect(tiles.getByText('Your usual')).toBeVisible()
  await expect(tiles.getByText('About 34 a month')).toBeVisible()
  await expect(tiles.getByText('last 4 weeks')).toBeVisible()
  // November so far, with the month's first and last day under its bar.
  const month = within(canvas.getByRole('region', { name: 'November so far' }))
  await expect(
    month.getByRole('progressbar', { name: 'Private ratings in November' }),
  ).toHaveAttribute('aria-valuetext', '23 of 40 private ratings, 9 days left, below pace')
  await expect(month.getByText('Nov 1')).toBeVisible()
  await expect(month.getByText('Nov 30')).toBeVisible()
  await expect(month.getByText('below pace')).toBeVisible()
  // Name order, even with Spa on 20 and Reception on 3; then the total.
  await expect(portalRows(canvas)).toEqual([
    ['Reception', '3'],
    ['Restaurant', '0'],
    ['Spa', '20'],
    ['All portals', '23'],
  ])
  await expect(changeTexts(canvas)).toEqual([
    'Oct 23 · Elena set 40 a month from November (recommended)',
    'Oct 15 · Spa went live',
    'Oct 9 · Reception and Restaurant went live',
  ])
  await expect(
    canvas.getByRole('button', { name: 'How this goal counts' }),
  ).toHaveAttribute('aria-expanded', 'false')
  // No month has closed yet, so no results to see; never "on pace".
  await expect(canvas.queryByRole('link', { name: 'All monthly results' })).toBeNull()
  await expect(canvas.queryByText(/on pace/u)).toBeNull()
  // The other Portal goals, one click deeper (P-5).
  await expect(
    canvas.getByText(
      'Want a number for one portal as well? Most properties don’t need one.',
    ),
  ).toBeVisible()
}

/** Nov 22, the mock's day. */
export const Running: Story = {
  play: async ({ canvasElement }) => expectRunning(within(canvasElement), canvasElement),
}

export const Phone390: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const Phone320: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const OnATablet: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const OnADesktop: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const Light: Story = {
  ...Running,
  parameters: { theme: 'light' },
}

/** Set on Oct 23 for November: its first month, and nothing counted yet. */
export const Scheduled: Story = {
  args: { page: PAGE_SCHEDULED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('November')).toBeVisible()
    await expect(tiles.getByText('40 private ratings')).toBeVisible()
    await expect(tiles.getByText('Starts on Nov 1')).toBeVisible()
    await expect(tiles.getByText('No goal yet')).toBeVisible()
    await expect(canvas.queryByRole('region', { name: /so far$/u })).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Month by month' })).toBeNull()
    await expect(canvas.getByRole('region', { name: 'Changes' })).toBeVisible()
  },
}

/** Spa has gone quiet: the page says since when, and its usual week. */
export const WithNoScanFacts: Story = {
  args: { page: PAGE_WITH_NO_SCAN_FACTS },
  play: async ({ canvasElement }) => {
    const section = within(
      within(canvasElement).getByRole('region', { name: 'From your portals' }),
    )
    await expect(
      section.getByText(
        /^Spa: no scans since Nov 15\. It usually gets about 7 a week\./u,
      ),
    ).toBeVisible()
    await expect(section.getByRole('link', { name: 'Open Spa' })).toHaveAttribute(
      'href',
      '/properties/p1/portals/portal-spa?tab=share',
    )
  },
}

/** Dec 22: each month a chip; one opens its facts and Escape brings the focus back. */
export const StripLater: Story = {
  args: { page: PAGE_LATER },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const strip = within(canvas.getByRole('list', { name: 'Month by month' }))
    const chips = strip.getAllByRole('button')
    await expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'December: 12 of 45 private ratings, running',
      'November: 41 of 40 private ratings, met',
      'October: 36 of 40 private ratings, not met',
    ])
    await expect(chips.map((chip) => chip.dataset['outcome'])).toEqual([
      'open',
      'met',
      'closed',
    ])
    const october = strip.getByRole('button', {
      name: 'October: 36 of 40 private ratings, not met',
    })
    await userEvent.click(october)
    const facts = within(
      await within(document.body).findByRole('dialog', { name: 'October' }),
    )
    await expect(facts.getByText('36 of 40 private ratings · not met')).toBeVisible()
    await expect(facts.getByText('Final on Nov 2')).toBeVisible()
    await expect(facts.getByText('Number in October: 40')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(october).toHaveFocus())
    // A month has closed: every month's result is a click away.
    await expect(
      canvas.getByRole('link', { name: 'All monthly results' }),
    ).toHaveAttribute('href', '/properties/p1/goals#monthly-results')
    await expect(changeTexts(canvas)).toContain(
      'Dec 1 · Elena set December to 45 (recommended)',
    )
  },
}

/** November was corrected on Dec 5: its chip's facts say so. */
export const Corrected: Story = {
  args: { page: PAGE_CORRECTED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'November: 41 of 40 private ratings, met' }),
    )
    const facts = within(
      await within(document.body).findByRole('dialog', { name: 'November' }),
    )
    await expect(facts.getByText('Corrected on Dec 5: 41 of 40, now met.')).toBeVisible()
  },
}

/** Counting scans: the body line and how it counts say scans. */
export const HowThisGoalCountsScans: Story = {
  args: { page: PAGE_SCANS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Scans from all 3 portals at Seaview Hotel.'),
    ).toBeVisible()
    const toggle = canvas.getByRole('button', { name: 'How this goal counts' })
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(
      canvas.getByText(/^Counts guests who open a portal from its code\./u),
    ).toBeVisible()
    await expect(canvas.getByText(/Months follow Sofia time/u)).toBeVisible()
  },
}

/** One published Portal: the page names it. */
export const OnePortal: Story = {
  args: { page: PAGE_ONE_PORTAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Private ratings from Reception at Seaview Hotel.'),
    ).toBeVisible()
    await expect(portalRows(canvas)).toEqual([
      ['Reception', '23'],
      ['All portals', '23'],
    ])
  },
}

/** After a stop: the months and changes of the goal before carry on, newest first. */
export const AcrossAStop: Story = {
  args: { page: PAGE_ACROSS_A_STOP },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(chipNames(canvas)).toEqual([
      'December: 12 of 45 private ratings, running',
      'November: 36 of 40 private ratings, not met',
      'October: 41 of 40 private ratings, met',
    ])
    await expect(changeTexts(canvas).slice(0, 3)).toEqual([
      'Nov 20 · Elena set 45 a month from December“Spa reopens in December”',
      'Nov 12 · Marco stopped the goal',
      'Sep 23 · Elena set 40 a month from October (recommended)',
    ])
    await expect(canvas.getByText('“Spa reopens in December”')).toBeVisible()
  },
}

/** Stopped on Nov 12: November still counts to its end. */
export const Stopped: Story = {
  args: { page: PAGE_STOPPED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Stopped on Nov 12. November still counts to Nov 30.'),
    ).toBeVisible()
    await expect(changeTexts(canvas)).toContain('Nov 12 · Marco stopped the goal')
  },
}

/** Fourteen changes: "Show all" goes once pressed, and the first change it adds takes the focus. */
export const ManyChanges: Story = {
  args: { page: PAGE_MANY_CHANGES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(changeTexts(canvas)).toHaveLength(12)
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    const items = within(canvas.getByRole('region', { name: 'Changes' })).getAllByRole(
      'listitem',
    )
    await expect(items).toHaveLength(14)
    await waitFor(() => expect(items[12]).toHaveFocus())
    await expect(canvas.queryByRole('button', { name: 'Show all' })).toBeNull()
  },
}

/** No goal yet: the card's own state, with Use, and the other Portal goals below. */
export const NoGoalYet: Story = {
  args: { page: PAGE_NO_GOAL },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    // The page's title names the card: no second "Monthly portal goal".
    await expect(outline(canvasElement)).toEqual([
      'h1 Monthly portal goal',
      'h2 More portal goals',
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Use 40' }))
    await waitFor(() =>
      expect(args.commands.setMonthlyPortalGoalFn).toHaveBeenCalledWith({
        data: {
          propertyId: 'p1',
          metric: 'portal_rating_count',
          targetValue: 40,
          startMonth: '2026-11',
          targetSource: 'recommended',
        },
      }),
    )
    // The card goes once the goal is read back: the page's title takes the focus.
    await waitFor(() => expect(canvas.getByRole('heading', { level: 1 })).toHaveFocus())
    await expect(canvas.queryByRole('list', { name: 'Month by month' })).toBeNull()
  },
}

/**
 * Dec 3, the goal stopped on Nov 12 and its November closed: no goal now, so
 * the card before one, and that goal's months and changes under it.
 */
export const NoGoalAfterAStop: Story = {
  args: { page: PAGE_NO_GOAL_AFTER_A_STOP },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Monthly portal goal',
      'h2 Month by month',
      'h2 Changes',
      'h2 More portal goals',
    ])
    await expect(chipNames(canvas)).toEqual(['November: 41 of 40 private ratings, met'])
    await expect(changeTexts(canvas).slice(0, 2)).toEqual([
      'Nov 12 · Marco stopped the goal',
      'Oct 23 · Elena set 40 a month from November (recommended)',
    ])
    await expect(
      canvas.getByRole('link', { name: 'All monthly results' }),
    ).toHaveAttribute('href', '/properties/p1/goals#monthly-results')
  },
}
