// The Monthly portal goal's page (PLAN PG-13): Seaview Hotel's goal on Nov 22,
// the mock's day (its tiles, November so far with the month's first and last
// day, each Portal's count in name order with the total, each month, what
// changed and how it counts); set and not yet begun; a quiet Portal; December
// with November and October closed (each month's facts on its chip); a
// corrected month; scans; one Portal; across a stop; stopped; many changes;
// no goal yet, where the page is the card's own state with its doors to the
// set sheet; and no goal after a stop, with that goal's months and changes.
// At 320, 390, 820 and 1440 px and on the light theme. The Storybook Vitest
// project compiles no Tailwind, so the plays assert words, roles, the heading
// outline and the calls. The sheet those doors open, as the page hosts it, is
// in the route's `-portal-goal-sheet-host.stories.tsx`. Its actions (PLAN
// PG-14): "Change number" and the menu's other measure open the change sheet,
// and Stop asks first, in the destructive tone (at 320 and 820 px too), then
// stops, says so and hands over to the route (which leaves for the Goals
// page); a goal that has not started is told it frees its month at once; a
// second Stop is said in place. "More portal goals" has its way to add one, as
// the route hands it in when the add sheet offers something; with nothing to
// add and no other goal there is no such block. A goal for one Portal or one
// group (PLAN PG-21) has the same page, titled for its subject, with no
// Portals' rows and the same actions; the average has it without a bar, with
// its months, what changed, its own "Change number" and Stop (at 1440, 820, 390
// and 320 px and on the light theme). The other states of those pages, and the
// average's change sheet, are `portal-goal-single-page.stories.tsx`'.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { toast } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ToasterDecorator } from '../../../.storybook/ToasterDecorator'
import { PortalGoalAveragePage } from './portal-goal-average-page'
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
import {
  changeCells,
  changeTexts,
  chipNames,
  expectStopAloneInMenu,
  headlineOf,
  outline,
  portalRows,
  tilesOf,
} from './portal-goal.stories.play'
import {
  AVERAGE_MORE_NEEDED,
  AVERAGE_RUNNING,
  SINGLE_RECEPTION,
  SINGLE_ROOMS,
} from './portal-goal-single-page.stories.fixtures'
import {
  singleGoalTitle,
  singleSubjectWords,
  subjectPlace,
} from './portal-goal-single-page-view'

const stopMock = fn(async () => ({ programId: 'program-monthly' }))
const onStoppedMock = fn(async () => undefined)
const onRefusedMock = fn(async () => undefined)

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
      stopMonthlyPortalGoalFn: stopMock,
      onStopped: onStoppedMock,
      onRefused: onRefusedMock,
    },
    personName,
    addLink: (
      <Button type="button" variant="link" size="inline" className="self-start text-sm">
        Add a portal goal
      </Button>
    ),
  },
  beforeEach: () => {
    // Sonner's store outlives a story: no toast of a stop here reaches another.
    toast.dismiss()
    for (const mock of [stopMock, onStoppedMock, onRefusedMock]) mock.mockClear()
    return () => void toast.dismiss()
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

async function expectRunning(canvas: Canvas, canvasElement: HTMLElement) {
  await expect(outline(canvasElement)).toEqual([
    'h1 Monthly portal goal',
    'h2 November so far',
    'h2 Your goal, so far',
    'h2 From your portals',
    'h2 Month by month',
    'h2 Changes',
    'h2 More portal goals',
  ])
  // What is left comes first, as on the first goal's page: the headline, the days left, then what it counts.
  const headline = headlineOf(canvas, '17 private ratings to 40')
  const days = canvas.getByText('9 days left in November')
  const counts = canvas.getByText('Private ratings from all 3 portals at Seaview Hotel.')
  await expect(headline).toBeVisible()
  await expect(days).toBeVisible()
  await expect(counts).toBeVisible()
  await expect(
    headline.compareDocumentPosition(days) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  await expect(
    days.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  const trail = within(canvas.getByRole('navigation', { name: 'breadcrumb' }))
  await expect(trail.getByRole('link', { name: 'Goals' })).toHaveAttribute(
    'href',
    '/properties/p1/goals',
  )
  // The tiles: November so far, October before the goal, the usual.
  await expect(canvas.getByRole('region', { name: 'Your goal, so far' })).toBeVisible()
  const tiles = tilesOf(canvasElement)
  await expect(tiles.getByText('November')).toBeVisible()
  await expect(tiles.getByText('23 of 40')).toBeVisible()
  await expect(tiles.getByText('17 to go · 9 days left')).toBeVisible()
  await expect(tiles.getByText('October')).toBeVisible()
  await expect(tiles.getByText('No goal yet')).toBeVisible()
  await expect(tiles.getByText('Your usual')).toBeVisible()
  await expect(tiles.getByText('About 34 a month')).toBeVisible()
  await expect(tiles.getByText('last 4 weeks')).toBeVisible()
  // November so far, with the month's first and last day under its bar, and
  // today's date under that.
  const month = within(canvas.getByRole('region', { name: 'November so far' }))
  await expect(
    month.getByRole('progressbar', { name: 'Private ratings in November' }),
  ).toHaveAttribute('aria-valuetext', '23 of 40 private ratings, 9 days left')
  await expect(month.getByText('Nov 1')).toBeVisible()
  await expect(month.getByText('Nov 30')).toBeVisible()
  await expect(month.getByText('It’s Nov 22')).toBeVisible()
  await expect(month.queryByText(/pace/iu)).toBeNull()
  // The pace is the pill in the page's header, where the first goal's page wears its own.
  const header = within(
    canvasElement.querySelector<HTMLElement>('#portal-goal-page-header') ?? canvasElement,
  )
  await expect(header.getByText('Below pace', { exact: true })).toBeVisible()
  // Name order, even with Spa on 20 and Reception on 3; then the total.
  await expect(portalRows(canvas)).toEqual([
    ['Reception', '3'],
    ['Restaurant', '0'],
    ['Spa', '20'],
    ['All portals', '23'],
  ])
  // The History list: the date in its cell, the words in theirs.
  await expect(changeCells(canvas)).toEqual([
    ['Oct 23', 'Elena set 40 a month from November (recommended)'],
    ['Oct 15', 'Spa went live'],
    ['Oct 9', 'Reception and Restaurant went live'],
  ])
  await expect(
    canvas.getByRole('button', { name: 'How this goal counts' }),
  ).toHaveAttribute('aria-expanded', 'false')
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
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('November')).toBeVisible()
    await expect(tiles.getByText('40 private ratings')).toBeVisible()
    await expect(tiles.getByText('Starts on Nov 1')).toBeVisible()
    await expect(tiles.getByText('No goal yet')).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'November so far' })).toBeNull()
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
    ).toHaveAttribute('href', '/properties/p1/goals/portal-results')
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
    // A notice, the first thing the page says, with the way to the next goal in it.
    const notice = within(canvas.getByRole('status'))
    await expect(
      notice.getByText('Stopped on Nov 12. November still counts to Nov 30.'),
    ).toBeVisible()
    await expect(
      notice.getByRole('button', { name: 'Set a goal from December' }),
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

/** Opens the goal's menu and picks an item, which hands over once the menu has closed. */
async function pickFromMenu(canvas: Canvas, item: string) {
  await userEvent.click(
    canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
  )
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: item }),
  )
}

/** "Stop this goal…" from the menu: the confirmation it opens. */
async function openStop(canvasElement: HTMLElement) {
  await pickFromMenu(within(canvasElement), 'Stop this goal…')
  const dialog = await within(document.body).findByRole('alertdialog', {
    name: 'Stop the monthly portal goal?',
  })
  return { dialog, in: within(dialog) }
}

/** "Change number" and "Count scans instead" open the change sheet; the measure only from next month. */
export const Actions: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change number' }))
    await expect(args.commands.openSheet).toHaveBeenLastCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
    await pickFromMenu(canvas, 'Count scans instead…')
    await waitFor(() =>
      expect(args.commands.openSheet).toHaveBeenLastCalledWith({
        mode: 'change',
        measure: 'qualified_scans',
      }),
    )
    // The menu's trigger keeps the focus for the sheet to hand back.
    await expect(
      canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
    ).toHaveFocus()
  },
}

/** Without goal.update or goal.cancel the actions are not drawn. */
export const ActionsNotAllowed: Story = {
  args: { canChange: false, canStop: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: 'More actions for Monthly portal goal' }),
    ).toBeNull()
  },
}

/** Stop asks first; the focus stays in the dialog; then it stops, says so and hands over. */
export const StopDialog: Story = {
  decorators: [ToasterDecorator],
  play: async ({ canvasElement, args }) => {
    const { dialog, in: inDialog } = await openStop(canvasElement)
    await expect(
      inDialog.getByText(
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    )
    await userEvent.tab()
    await expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await userEvent.tab()
    await expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await userEvent.click(inDialog.getByRole('button', { name: 'Stop the goal' }))
    await expect(args.stop.stopMonthlyPortalGoalFn).toHaveBeenCalledWith({
      data: { propertyId: SEAVIEW.propertyId, programId: 'program-monthly' },
    })
    const said = await within(document.body).findByText('Monthly portal goal stopped')
    await waitFor(() => expect(said).toBeVisible())
    // The route leaves for the Goals page from here.
    await waitFor(() => expect(args.stop.onStopped).toHaveBeenCalledOnce())
  },
}

/** 320 px: the question, what happens and both buttons, in the destructive dialog. */
export const StopDialogOnANarrowPhone: Story = {
  play: async ({ canvasElement }) => {
    const { in: inDialog } = await openStop(canvasElement)
    await expect(
      inDialog.getByText(
        'November keeps counting to Nov 30 and keeps its result. You can set a new goal from December.',
      ),
    ).toBeVisible()
    await expect(inDialog.getByRole('button', { name: 'Keep the goal' })).toBeVisible()
    await expect(inDialog.getByRole('button', { name: 'Stop the goal' })).toBeVisible()
  },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

export const StopDialogOnATablet: Story = {
  ...StopDialogOnANarrowPhone,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

/** "Keep the goal" stops nothing, and the focus goes back to the menu's trigger. */
export const StopKept: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const { dialog, in: inDialog } = await openStop(canvasElement)
    await userEvent.click(inDialog.getByRole('button', { name: 'Keep the goal' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await expect(args.stop.stopMonthlyPortalGoalFn).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: 'More actions for Monthly portal goal' }),
      ).toHaveFocus(),
    )
  },
}

/** A goal that has not started frees its month at once. */
export const StopScheduled: Story = {
  args: { page: PAGE_SCHEDULED },
  play: async ({ canvasElement, args }) => {
    const { in: dialog } = await openStop(canvasElement)
    await expect(
      dialog.getByText(
        'November has not started, so nothing has counted yet. You can set a new goal straight away.',
      ),
    ).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Stop the goal' }))
    await waitFor(() => expect(args.stop.onStopped).toHaveBeenCalledOnce())
  },
}

/** F-5: stopped a moment ago elsewhere. The dialog says so and the page is read again. */
export const StopAlreadyStopped: Story = {
  args: {
    stop: {
      stopMonthlyPortalGoalFn: fn(async () => {
        throw new ServerFunctionError(
          'GoalProgramError',
          'invalid_transition',
          'invalid_transition',
          409,
        )
      }),
      onStopped: fn(async () => undefined),
      onRefused: fn(async () => undefined),
    },
  },
  play: async ({ canvasElement, args }) => {
    const { in: dialog } = await openStop(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Stop the goal' }))
    await expect(
      await dialog.findByText('This goal was already stopped. Here is the latest.'),
    ).toBeVisible()
    await expect(args.stop.onRefused).toHaveBeenCalledOnce()
    await expect(args.stop.onStopped).not.toHaveBeenCalled()
  },
}

/** A stopped goal takes no change and no second stop: no actions; the next goal from December. */
export const StoppedHasNoActions: Story = {
  args: { page: PAGE_STOPPED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Change number' })).toBeNull()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Set a goal from December' }),
    )
    await expect(args.commands.openSheet).toHaveBeenCalledWith({
      measure: 'portal_rating_count',
      month: '2026-12',
    })
  },
}

// ─── A goal for one portal, one group or the average (PLAN PG-21) ──────────

/** What the route hands in for a Portal's or a group's goal: its page, titled for it. */
const singleArgs = (view: typeof SINGLE_RECEPTION) => ({
  page: view.page,
  single: {
    title: singleGoalTitle(view.subject),
    name: singleSubjectWords(view.subject),
    where: subjectPlace(view.subject) ?? '',
    canSwitch: !view.otherMeasureHeld,
  },
  extras: null,
  addLink: null,
})

const SINGLE_OUTLINE = [
  'h2 November so far',
  'h2 Your goal, so far',
  'h2 Month by month',
  'h2 Changes',
]

/** Reception's own goal: its month and changes, no Portals' rows, and the same actions. */
export const SinglePortalGoal: Story = {
  args: singleArgs(SINGLE_RECEPTION),
  decorators: [ToasterDecorator],
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Reception · portal goal',
      ...SINGLE_OUTLINE,
    ])
    await expect(
      canvas.getByText('Private ratings from Reception at Seaview Hotel.'),
    ).toBeVisible()
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('13 of 22')).toBeVisible()
    await expect(tiles.getByText('About 20 a month')).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'From your portals' })).toBeNull()
    await expect(changeTexts(canvas)).toEqual([
      'Oct 23 · Elena set 22 a month from November (recommended)',
      'Oct 9 · Reception went live',
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Change number' }))
    await expect(args.commands.openSheet).toHaveBeenLastCalledWith({
      mode: 'change',
      measure: 'portal_rating_count',
    })
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Reception · portal goal' }),
    )
    const body = within(document.body)
    await expect(
      await body.findByRole('menuitem', { name: 'Count scans instead…' }),
    ).toBeVisible()
    await userEvent.click(body.getByRole('menuitem', { name: 'Stop this goal…' }))
    const dialog = await body.findByRole('alertdialog', {
      name: 'Stop this portal goal?',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop the goal' }))
    await expect(args.stop.stopMonthlyPortalGoalFn).toHaveBeenCalledWith({
      data: { propertyId: SEAVIEW.propertyId, programId: 'program-reception' },
    })
    const said = await body.findByText('Portal goal stopped')
    await waitFor(() => expect(said).toBeVisible())
    await waitFor(() => expect(args.stop.onStopped).toHaveBeenCalledOnce())
  },
}

export const SinglePortalGoalLight: Story = {
  args: singleArgs(SINGLE_RECEPTION),
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    await expect(outline(canvasElement)[0]).toBe('h1 Reception · portal goal')
  },
}

/** The Rooms group's goal: named as the Goals list names a group, its Portals' go-live. */
export const GroupGoal: Story = {
  args: singleArgs(SINGLE_ROOMS),
  parameters: { viewport: { defaultViewport: 'tablet' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Rooms (group) · portal goal',
      ...SINGLE_OUTLINE,
    ])
    await expect(
      canvas.getByText('Private ratings from Rooms (group) at Seaview Hotel.'),
    ).toBeVisible()
    await expect(tilesOf(canvasElement).getByText('21 of 35')).toBeVisible()
    await expect(changeTexts(canvas)).toEqual([
      'Oct 23 · Elena set 35 a month from November (recommended)',
      'Oct 9 · Reception and Restaurant went live',
    ])
  },
}

/** What the route hands the average's page: its read, its change and its stop. */
const averageCommands = {
  changeMonthlyPortalGoalNowFn: fn(async () => ({})),
  reviseMonthlyPortalGoalFn: fn(async () => ({})),
  onChanged: fn(async () => undefined),
  reread: fn(async () => undefined),
}

/** The average: its page without a bar, its months and changes, Change number and Stop. */
export const AverageGoal: Story = {
  render: (args) => (
    <PortalGoalAveragePage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={AVERAGE_RUNNING}
      canChange={args.canChange}
      canStop={args.canStop}
      commands={averageCommands}
      stop={args.stop}
      personName={args.personName}
    />
  ),
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(outline(canvasElement)).toEqual([
      'h1 Average private rating',
      'h2 Your goal, so far',
      'h2 Month by month',
      'h2 Changes',
    ])
    await expect(
      canvas.getByText(
        'The average private rating guests give at your portals. A month needs at least 10 ratings.',
      ),
    ).toBeVisible()
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('November')).toBeVisible()
    await expect(tiles.getByText('4.6 so far · goal 4.5')).toBeVisible()
    await expect(tiles.getByText('9 days left')).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(chipNames(canvas)).toEqual([
      'November: 4.6 · goal 4.5, running',
      'October: 4.6 · goal 4.5, met',
    ])
    await expect(changeTexts(canvas)).toEqual(['Sep 28 · Elena set 4.5 from October'])
    await expect(canvas.getByRole('button', { name: 'Change number' })).toBeVisible()
    await expectStopAloneInMenu(canvas, 'Average private rating')
  },
}

/** Six of the ten ratings a month needs: no average is shown yet. */
export const AverageMoreNeeded: Story = {
  ...AverageGoal,
  render: (args) => (
    <PortalGoalAveragePage
      propertyId={args.propertyId}
      propertyName={args.propertyName}
      view={AVERAGE_MORE_NEEDED}
      canChange={args.canChange}
      canStop={args.canStop}
      commands={averageCommands}
      stop={args.stop}
      personName={args.personName}
    />
  ),
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async ({ canvasElement }) => {
    const tiles = tilesOf(canvasElement)
    await expect(tiles.getByText('More ratings needed · 6 of 10')).toBeVisible()
    await expect(tiles.getByText('9 days left')).toBeVisible()
  },
}
