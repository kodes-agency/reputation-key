// The Monthly portal goal's page (PLAN PG-13; ADR 0068 amended 2026-11-01): Seaview
// Hotel's goal on Nov 22, the mock's day. Where the goal stands comes first (what is
// left, the days left and what a day takes, the ruler with a steady month's stop on
// it); then three questions in bands: where they are coming from (each Portal's
// count in name order with the total, a Portal gone quiet named), how this month
// compares (each month's bar against its own number once there are two) and what to
// do this week; "What changed" and "How this goal counts" are closed until asked.
// Also: set and not yet begun; the first quiet days; the number passed; a quiet
// Portal; December with November and October closed; a corrected month; scans; one
// Portal; across a stop; stopped; many changes; no goal yet, where the page is the
// card's own state with its doors to the set sheet; and no goal after a stop, with
// that goal's months and changes. At 320, 390, 820 and 1440 px and on the light
// theme. The Storybook Vitest project compiles no Tailwind, so the plays assert
// words, roles, the heading outline and the calls. The sheet those doors open, as
// the page hosts it, is in the route's `-portal-goal-sheet-host.stories.tsx`. Its
// actions (PLAN PG-14) are in `portal-goal-page-actions.stories.tsx`, and the other
// goals' pages (PLAN PG-21: one Portal, one group, the average) in
// `portal-goal-single-page.stories.tsx`. "More portal goals" has its way to add one,
// as the route hands it in when the add sheet offers something; with nothing to add
// and no other goal there is no such block.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
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
import { CARD_FIRST_DAYS, CARD_PASSED } from './portal-goal-running.stories.fixtures'
import {
  barLines,
  barsOf,
  changeCells,
  changeDateWidths,
  changeTexts,
  chipNames,
  expectBarsReadByKeyboard,
  headlineOf,
  openClosedCard,
  openWhatChanged,
  outline,
  portalRows,
  whereOf,
} from './portal-goal.stories.play'

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
    canChange: true,
    canStop: true,
    // As the route hands them in: before a goal, the card's doors open the set sheet.
    commands: { setMonthlyPortalGoalFn: fn(), onSet: fn(), openSheet: fn() },
    stop: {
      stopMonthlyPortalGoalFn: fn(async () => ({ programId: 'program-monthly' })),
      onStopped: fn(async () => undefined),
      onRefused: fn(async () => undefined),
    },
    personName,
    addLink: (
      <Button type="button" variant="link" size="inline" className="self-start text-sm">
        Add a portal goal
      </Button>
    ),
  },
  beforeEach: () => {
    // Sonner's store outlives a story: no toast of Use reaches another.
    toast.dismiss()
    return () => void toast.dismiss()
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

const WHERE = 'Where are they coming from?'
const COMPARE = 'How does this month compare?'
const TODO = 'What can you do this week?'
const MONTH_BARS = 'Private ratings each month. The short line is that month’s number.'

/** One of the three questions, as the region it is. */
const band = (canvas: Canvas, question: string) =>
  within(canvas.getByRole('region', { name: question }))

/** The page's pace is the pill in its header, where the first goal's page wears its own. */
const headerOf = (canvasElement: HTMLElement) =>
  within(
    canvasElement.querySelector<HTMLElement>('#portal-goal-page-header') ?? canvasElement,
  )

/** The three questions, the closed cards and the other goals, in the order a manager reads them. */
const PAGE_OUTLINE = [
  'h1 Monthly portal goal',
  `h2 ${WHERE}`,
  `h2 ${COMPARE}`,
  `h2 ${TODO}`,
  'h2 What changed',
  'h2 How this goal counts',
  'h2 More portal goals',
]

/** Nov 22: what is left comes first, then the days left and what a day takes, then the ruler. */
async function expectWhereItStands(canvasElement: HTMLElement) {
  const where = whereOf(canvasElement)
  const headline = headlineOf(where, '17 private ratings to 40')
  const days = where.getByText('9 days left in November. About 2 a day gets you there.')
  const ruler = where.getByRole('img', {
    name: '23 of 40 private ratings so far. A steady month would be at about 29 by today.',
  })
  for (const part of [headline, days, ruler]) await expect(part).toBeVisible()
  await expect(
    headline.compareDocumentPosition(days) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  await expect(
    days.compareDocumentPosition(ruler) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  // The ruler's own words: where it starts, a steady month's stop, its end and where the month stands.
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
  // The pace is the pill in the header and in no other words.
  await expect(where.queryByText(/below pace|on pace/iu)).toBeNull()
}

/** Nov 22: each Portal in name order, the usual and the pace so far, and what to do. */
async function expectBands(canvas: Canvas) {
  const where = band(canvas, WHERE)
  await expect(where.getByText('From 2 of your 3 portals')).toBeVisible()
  // Name order, even with Spa on 20 and Reception on 3; then the total.
  await expect(portalRows(canvas)).toEqual([
    ['Reception', '3'],
    ['Restaurant', '0'],
    ['Spa', '20'],
    ['All portals', '23'],
  ])
  const compare = band(canvas, COMPARE)
  await expect(compare.getByText('About your usual')).toBeVisible()
  await expect(
    compare.getByText(
      'You usually get about 34 a month. At this pace you’d end around 31.',
    ),
  ).toBeVisible()
  // One month so far: the bars wait for a second.
  await expect(
    compare.getByText('Each month will build up here, against its own number.'),
  ).toBeVisible()
  const todo = band(canvas, TODO)
  await expect(todo.getByText('Ask every guest', { exact: true })).toBeVisible()
  await expect(
    todo.getByText(
      'Ask every guest, not only happy ones. Low and high ratings count the same.',
    ),
  ).toBeVisible()
  await expect(todo.getByRole('link', { name: /^Open your portals/u })).toHaveAttribute(
    'href',
    '/properties/p1/portals',
  )
  await expect(todo.getByRole('button', { name: /^Change the number/u })).toBeVisible()
  await expect(todo.getByText('Your usual is about 34 a month.')).toBeVisible()
}

/** "What changed" and "How this goal counts": closed until asked, then read. */
async function expectClosedCards(canvas: Canvas) {
  await expect(canvas.getByRole('button', { name: 'What changed' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  const counts = canvas.getByRole('button', { name: 'How this goal counts' })
  await expect(counts).toHaveAttribute('aria-expanded', 'false')
  await expect(canvas.queryByText(/^Counts the 1–5 star private ratings/u)).toBeNull()
  // The History list: the date in its cell, the words in theirs.
  await expect(await changeCells(canvas)).toEqual([
    ['Oct 23', 'Elena set 40 a month from November (recommended)'],
    ['Oct 15', 'Spa went live'],
    ['Oct 9', 'Reception and Restaurant went live'],
  ])
  // Every date is of this year: the cells keep their class's five rem.
  await expect(await changeDateWidths(canvas)).toEqual(['', '', ''])
  await openClosedCard(canvas, 'How this goal counts')
  await expect(
    canvas.getByText(
      /^Counts the 1–5 star private ratings guests give at any of your portals\./u,
    ),
  ).toBeVisible()
}

async function expectRunning(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(outline(canvasElement)).toEqual(PAGE_OUTLINE)
  const trail = within(canvas.getByRole('navigation', { name: 'breadcrumb' }))
  await expect(trail.getByRole('link', { name: 'Goals' })).toHaveAttribute(
    'href',
    '/properties/p1/goals',
  )
  await expect(
    headerOf(canvasElement).getByText('Below pace', { exact: true }),
  ).toBeVisible()
  await expectWhereItStands(canvasElement)
  await expectBands(canvas)
  await expectClosedCards(canvas)
  // What this page no longer has: tiles, a meter, a month strip or a count in a line.
  await expect(canvasElement.querySelector('[data-slot="metric-strip"]')).toBeNull()
  await expect(canvas.queryByRole('progressbar')).toBeNull()
  await expect(canvas.queryByRole('list', { name: 'Month by month' })).toBeNull()
  await expect(canvas.queryByText(/^Private ratings from all 3 portals/u)).toBeNull()
  // No month has closed yet, so no results to see; behind, so never "on pace".
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
    const where = whereOf(canvasElement)
    await expect(where.getByText('November · 40 private ratings')).toBeVisible()
    await expect(where.getByText('Starts on Nov 1 · October so far: 12')).toBeVisible()
    // Nothing counts yet: no ruler, no Portals' counts, and nothing to compare.
    await expect(where.queryByRole('img')).toBeNull()
    await expect(canvas.queryByRole('region', { name: WHERE })).toBeNull()
    await expect(
      band(canvas, COMPARE).getByText('No month is counting now'),
    ).toBeVisible()
    await expect(
      band(canvas, COMPARE).getByText('You usually get about 34 a month.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('list', { name: 'Month by month' })).toBeNull()
    await expect(canvas.getByRole('region', { name: 'What changed' })).toBeVisible()
  },
}

/** Nov 2, the first quiet days: 1 of 40, from Reception only, and no pace to judge. */
const PAGE_FIRST_DAYS: typeof PAGE_RUNNING = {
  ...PAGE_RUNNING,
  card: CARD_FIRST_DAYS,
  today: '2026-11-02',
  rows: {
    portals: [
      { portalId: 'portal-reception', name: 'Reception', count: 1 },
      { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
      { portalId: 'portal-spa', name: 'Spa', count: 0 },
    ],
    elsewhere: 0,
    total: 1,
    truncated: false,
  },
  months: PAGE_RUNNING.months.map((month) => ({ ...month, value: 1 })),
  changes: PAGE_RUNNING.changes.slice(0, 1),
}

/** The first quiet days: nothing is judged yet, and it is too early to say how the month compares. */
export const FirstDays: Story = {
  args: { page: PAGE_FIRST_DAYS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(
      headerOf(canvasElement).getByText('Getting started', { exact: true }),
    ).toBeVisible()
    await expect(headlineOf(where, '39 private ratings to 40')).toBeVisible()
    await expect(
      where.getByText('29 days left in November. About 1 a day gets you there.'),
    ).toBeVisible()
    // The ruler has no steady stop yet.
    const ruler = where.getByRole('img', { name: '1 of 40 private ratings so far.' })
    await expect(within(ruler).queryByText('steady pace')).toBeNull()
    await expect(band(canvas, WHERE).getByText('From 1 of your 3 portals')).toBeVisible()
    await expect(band(canvas, COMPARE).getByText('Too early to say')).toBeVisible()
    await expect(
      band(canvas, COMPARE).getByText('You usually get about 34 a month.'),
    ).toBeVisible()
  },
}

/** Nov 27, G18: 41 of 40, passed with 4 days left; Reception brought in most of it. */
const PAGE_PASSED: typeof PAGE_RUNNING = {
  ...PAGE_RUNNING,
  card: CARD_PASSED,
  today: '2026-11-27',
  rows: {
    portals: [
      { portalId: 'portal-reception', name: 'Reception', count: 22 },
      { portalId: 'portal-restaurant', name: 'Restaurant', count: 11 },
      { portalId: 'portal-spa', name: 'Spa', count: 8 },
    ],
    elsewhere: 0,
    total: 41,
    truncated: false,
  },
  months: PAGE_RUNNING.months.map((month) => ({ ...month, value: 41 })),
}

/** The number passed with 4 days left: the ruler is full and checked, the month is better than usual. */
export const Passed: Story = {
  args: { page: PAGE_PASSED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(
      headerOf(canvasElement).getByText('On pace', { exact: true }),
    ).toBeVisible()
    await expect(headlineOf(where, 'Goal passed: 41 private ratings')).toBeVisible()
    // Nothing left to get, so no word of what a day takes.
    await expect(
      where.getByText('4 days left in November', { exact: true }),
    ).toBeVisible()
    const ruler = where.getByRole('img', { name: '41 of 40 private ratings so far.' })
    await expect(within(ruler).queryByText('steady pace')).toBeNull()
    await expect(
      band(canvas, WHERE).getByText('All 3 portals are bringing them in'),
    ).toBeVisible()
    await expect(band(canvas, COMPARE).getByText('Better than usual')).toBeVisible()
    await expect(
      band(canvas, COMPARE).getByText(
        'You usually get about 34 a month. At this pace you’d end around 46.',
      ),
    ).toBeVisible()
    await expect(band(canvas, TODO).getByText('Keep going')).toBeVisible()
  },
}

/** Spa has gone quiet: the band names it, its row says since when, and the way to its code is there twice. */
export const WithNoScanFacts: Story = {
  args: { page: PAGE_WITH_NO_SCAN_FACTS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = band(canvas, WHERE)
    await expect(where.getByText('Spa has gone quiet')).toBeVisible()
    await expect(
      where.getByText(
        'Spa: no scans since Nov 15. It usually gets about 7 a week. Is it where guests can see it?',
      ),
    ).toBeVisible()
    // On its own row, with the way to its code; nothing else is named.
    const row = within(where.getByRole('list', { name: 'From your portals' }))
    await expect(row.getByText('No scans since Nov 15')).toBeVisible()
    await expect(row.getByRole('link', { name: 'Open Spa' })).toHaveAttribute(
      'href',
      '/properties/p1/portals/portal-spa?tab=share',
    )
    // What to do about it comes first among the ways on.
    const todo = band(canvas, TODO)
    await expect(todo.getByRole('link', { name: /^Check Spa’s code/u })).toHaveAttribute(
      'href',
      '/properties/p1/portals/portal-spa?tab=share',
    )
    await expect(todo.queryByRole('link', { name: /^Open your portals/u })).toBeNull()
  },
}

/** Dec 22: each month a bar against its own number; the keyboard reads them one by one. */
export const BarsLater: Story = {
  args: { page: PAGE_LATER },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const compare = band(canvas, COMPARE)
    await expect(compare.getByText('A slower month so far')).toBeVisible()
    await expect(
      compare.getByText(
        'You usually get about 38 a month. At this pace you’d end around 17.',
      ),
    ).toBeVisible()
    await expect(
      compare.queryByText('Each month will build up here, against its own number.'),
    ).toBeNull()
    const bars = barsOf(compare, MONTH_BARS)
    // Oldest first, each with its own number, as the list a screen reader reads.
    const october =
      'October: 36 of 40 private ratings · not met · Final on Nov 2 · Number in October: 40'
    const december =
      'December: 12 of 45 private ratings · running · Final on Jan 2 · Number in December: 45'
    await expect(barLines(bars)).toEqual([
      october,
      'November: 41 of 40 private ratings · met · Final on Dec 2 · Number in November: 40',
      december,
    ])
    await expectBarsReadByKeyboard(bars, {
      hint: 'Hover or tap a bar to read that month.',
      first: october,
      last: december,
    })
    // A month has closed: every month's result is a click away.
    await expect(
      canvas.getByRole('link', { name: 'All monthly results' }),
    ).toHaveAttribute('href', '/properties/p1/goals/portal-results')
    await expect(await changeTexts(canvas)).toContain(
      'Dec 1 · Elena set December to 45 (recommended)',
    )
  },
}

/** November was corrected on Dec 5: its bar's words say so. */
export const Corrected: Story = {
  args: { page: PAGE_CORRECTED },
  play: async ({ canvasElement }) => {
    const bars = barsOf(band(within(canvasElement), COMPARE), MONTH_BARS)
    await expect(barLines(bars)[1]).toBe(
      'November: 41 of 40 private ratings · met · Final on Dec 2 · Number in November: 40 · Corrected on Dec 5: 41 of 40, now met.',
    )
  },
}

/** Counting scans: the ruler, the way on and how scans count all say scans. */
export const HowThisGoalCountsScans: Story = {
  args: { page: PAGE_SCANS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const where = whereOf(canvasElement)
    await expect(headlineOf(where, '17 scans to 40')).toBeVisible()
    await expect(
      where.getByRole('img', {
        name: '23 of 40 scans so far. A steady month would be at about 29 by today.',
      }),
    ).toBeVisible()
    await expect(
      band(canvas, TODO).getByText('Put your codes where guests can see them.'),
    ).toBeVisible()
    const toggle = await openClosedCard(canvas, 'How this goal counts')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(
      canvas.getByText(/^Counts guests who open a portal from its code\./u),
    ).toBeVisible()
    await expect(canvas.getByText(/Months follow Sofia time/u)).toBeVisible()
  },
}

/** It counted private ratings in September and scans since October. */
const PAGE_EARLIER_RATINGS: typeof PAGE_SCANS = {
  ...PAGE_SCANS,
  months: [
    ...PAGE_SCANS.months,
    {
      key: '2026-10',
      measure: 'qualified_scans',
      value: 52,
      target: 55,
      outcome: 'not_met',
      finalOn: '2026-11-02',
      correction: null,
    },
    {
      key: '2026-09',
      measure: 'portal_rating_count',
      value: 38,
      target: 40,
      outcome: 'not_met',
      finalOn: '2026-10-02',
      correction: null,
    },
  ],
}

/** The bars are of what the goal counts now; the months it counted something else are left out, and said so. */
export const EarlierMonthsCountedSomethingElse: Story = {
  args: { page: PAGE_EARLIER_RATINGS },
  play: async ({ canvasElement }) => {
    const compare = band(within(canvasElement), COMPARE)
    const bars = barsOf(
      compare,
      'Scans each month. The short line is that month’s number.',
    )
    await expect(barLines(bars)).toEqual([
      'October: 52 of 55 scans · not met · Final on Nov 2 · Number in October: 55',
      'November: 23 of 40 scans · running · Final on Dec 2 · Number in November: 40',
    ])
    await expect(
      compare.getByText('Earlier months counted private ratings.'),
    ).toBeVisible()
  },
}

/** One published Portal: the band names it, as the only one there is. */
export const OnePortal: Story = {
  args: { page: PAGE_ONE_PORTAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(band(canvas, WHERE).getByText('All from Reception')).toBeVisible()
    await expect(portalRows(canvas)).toEqual([
      ['Reception', '23'],
      ['All portals', '23'],
    ])
  },
}

/** After a stop: the months and changes of the goal before carry on, the months oldest first. */
export const AcrossAStop: Story = {
  args: { page: PAGE_ACROSS_A_STOP },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bars = barsOf(band(canvas, COMPARE), MONTH_BARS)
    await expect(barLines(bars)).toEqual([
      'October: 41 of 40 private ratings · met · Final on Nov 2 · Number in October: 40',
      'November: 36 of 40 private ratings · not met · Final on Dec 2 · Number in November: 40',
      'December: 12 of 45 private ratings · running · Final on Jan 2 · Number in December: 45',
    ])
    await expect((await changeTexts(canvas)).slice(0, 3)).toEqual([
      'Nov 20 · Elena set 45 a month from December“Spa reopens in December”',
      'Nov 12 · Marco stopped the goal',
      'Sep 23 · Elena set 40 a month from October (recommended)',
    ])
    await expect(canvas.getByText('“Spa reopens in December”')).toBeVisible()
  },
}

/** Stopped on Nov 12: November still counts to its end, and there is nothing left to do. */
export const Stopped: Story = {
  args: { page: PAGE_STOPPED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A notice, the first thing the page says, with the way to the next goal in it.
    const notice = within(canvas.getByRole('status'))
    await expect(
      notice.getByText('Stopped on Nov 12. November still counts to Nov 30.'),
    ).toBeVisible()
    await expect(
      notice.getByRole('button', { name: 'Set a goal from December' }),
    ).toBeVisible()
    // Where it stood, and the questions about the past; no "what can you do this week".
    await expect(
      whereOf(canvasElement).getByRole('img', {
        name: /^23 of 40 private ratings so far/u,
      }),
    ).toBeVisible()
    await expect(canvas.queryByRole('region', { name: TODO })).toBeNull()
    await expect(await changeTexts(canvas)).toContain('Nov 12 · Marco stopped the goal')
  },
}

/** Nov 22 with changes from the year before: their dates say their year. */
const PAGE_CHANGES_ACROSS_A_YEAR: typeof PAGE_RUNNING = {
  ...PAGE_RUNNING,
  changes: [
    ...PAGE_RUNNING.changes.slice(0, 1),
    { kind: 'went_live', on: '2025-12-28', portals: ['Spa'] },
    { kind: 'went_live', on: '2025-03-03', portals: ['Reception', 'Restaurant'] },
  ],
}

/** A change of another year says its year, and the date column has room for it in every row. */
export const ChangesAcrossAYear: Story = {
  args: { page: PAGE_CHANGES_ACROSS_A_YEAR },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await changeCells(canvas)).toEqual([
      ['Oct 23', 'Elena set 40 a month from November (recommended)'],
      ['Dec 28, 2025', 'Spa went live'],
      ['Mar 3, 2025', 'Reception and Restaurant went live'],
    ])
    await expect(await changeDateWidths(canvas)).toEqual(['6rem', '6rem', '6rem'])
  },
}

/** Fourteen changes: "Show all" goes once pressed, and the first change it adds takes the focus. */
export const ManyChanges: Story = {
  args: { page: PAGE_MANY_CHANGES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await changeTexts(canvas)).toHaveLength(12)
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    const items = (await openWhatChanged(canvas)).getAllByRole('listitem')
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
    // The card's door to the set sheet, as on the Goals page.
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }))
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      measure: 'portal_rating_count',
    })
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
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Monthly portal goal',
      'h2 Month by month',
      'h2 What changed',
      'h2 More portal goals',
    ])
    await expect(chipNames(canvas)).toEqual(['November: 41 of 40 private ratings, met'])
    await expect((await changeTexts(canvas)).slice(0, 2)).toEqual([
      'Nov 12 · Marco stopped the goal',
      'Oct 23 · Elena set 40 a month from November (recommended)',
    ])
    await expect(
      canvas.getByRole('link', { name: 'All monthly results' }),
    ).toHaveAttribute('href', '/properties/p1/goals/portal-results')
    await userEvent.click(canvas.getByRole('button', { name: 'Set a number anyway' }))
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      measure: 'portal_rating_count',
    })
  },
}

/** The M-rule: nothing to add and no other portal goal, so no "More portal goals". */
export const NothingMoreToAdd: Story = {
  args: { page: PAGE_NO_GOAL, addLink: null, extras: null },
  play: async ({ canvasElement }) => {
    await expect(outline(canvasElement)).toEqual(['h1 Monthly portal goal'])
    await expect(
      within(canvasElement).queryByText(
        'Want a number for one portal as well? Most properties don’t need one.',
      ),
    ).toBeNull()
  },
}
