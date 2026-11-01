// The Portal goal results list (2026-11-01, ADR 0068; it replaces the results matrix):
// one card per goal, titled by its name and by whom it counted where it counts one
// Portal or group, its months in a manager's words, newest first ("41 of 40", Met,
// Missed by 4), and once there are two months of a count, a bar for each against its
// own number. When a figure was final and who set the number are one tap away, on the
// row. States: every kind of result a month can have (missed, still being counted,
// an average that needs more ratings, a count that could not be read, an average
// met), one and thousands, a number set in an earlier year, a month whose number a
// manager changed (it names who), a corrected month, and a goal with four months and
// its bars. At 320, 390, 820 and 1440 px and on the light theme. The Storybook Vitest
// project compiles no Tailwind, so the plays assert words, roles and what a tap
// opens; at the narrow widths they also measure that nothing scrolls sideways.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { PortalGoalResultsList } from './portal-goal-results-list'
import {
  ALL_EVIDENCE_STATES,
  CHANGED_IN_JULY,
  CORRECTED_MONTH,
  FOUR_MONTHS,
  LIST_NOW,
  ONE_AND_THOUSANDS,
  SET_IN_AN_EARLIER_YEAR,
  listPersonName,
} from './portal-goal-results-list.stories.fixtures'
import { barLines, barsOf, expectBarsReadByKeyboard } from './portal-goal.stories.play'

const meta: Meta<typeof PortalGoalResultsList> = {
  title: 'Goals/PortalGoalResultsList',
  component: PortalGoalResultsList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { matrix: ALL_EVIDENCE_STATES, now: LIST_NOW, personName: listPersonName },
}
export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/** The goals' titles in the order drawn, as "Front desk ratings · Front desk". */
const titlesOf = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('h2')].map((heading) => heading.textContent ?? '')

/** A goal's months, by the goal's name (or the block of months it counted). */
const monthsOf = (canvas: Canvas, name: string) =>
  within(canvas.getByRole('list', { name }))

/** The row of one month of a list: its name also carries the figure and the verdict. */
const rowOf = (months: Canvas, month: string): HTMLElement =>
  months.getByRole('button', { name: (name: string) => name.startsWith(month) })

/** The row of July 2026 in `Each month of <goal>`. */
const julyOf = (canvas: Canvas, goal: string): HTMLElement =>
  rowOf(monthsOf(canvas, `Each month of ${goal}`), 'July 2026')

/** Presses a row open (they are closed until asked) and says what it then shows. */
async function openRow(row: HTMLElement): Promise<string[]> {
  if (row.getAttribute('aria-expanded') !== 'true') await userEvent.click(row)
  await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'))
  return [...(row.closest('li')?.querySelectorAll('p') ?? [])].map(
    (line) => line.textContent ?? '',
  )
}

/** Each goal's July row, as "figure | verdict": what the list says of every kind of result. */
const STATES = [
  ['Monthly scans', '0 of 100', 'Missed by 100'],
  ['Front desk ratings', '7 of 100', 'The final figure is on its way'],
  ['Breakfast average', '–', 'More ratings needed: 6 of 10'],
  ['Lobby ratings', '–', 'No result for this month'],
  ['Spa average', '4.6 · goal 4.5', 'Met'],
] as const

export const AllEvidenceStates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // One card per goal, titled by its name, and by whom it counted where it counts one.
    await expect(titlesOf(canvasElement)).toEqual([
      'Monthly scans',
      'Front desk ratings · Front desk',
      'Breakfast average · Breakfast cards',
      'Lobby ratings · Lobby NFC',
      'Spa average · Spa',
    ])
    for (const [goal, figure, verdict] of STATES) {
      const row = within(julyOf(canvas, goal))
      await expect(row.getByText(figure, { exact: true })).toBeVisible()
      await expect(row.getByText(verdict, { exact: true })).toBeVisible()
      await expect(julyOf(canvas, goal)).toHaveAttribute('aria-expanded', 'false')
    }
    // Closed until asked: when a figure was final and who set the number are not drawn.
    await expect(canvas.queryByText(/^Counted through/u)).toBeNull()
    // In a manager's words: no internals, no table's columns, no ranking.
    await expect(
      canvas.queryByText(/Metric rules|Program version|Effective |Data through/u),
    ).toBeNull()
    await expect(canvas.queryByText(/rank|composite/iu)).toBeNull()
    await expect(canvas.queryByRole('table')).toBeNull()
    // One tap opens a row: the day the figure was counted through, and the number with its day.
    await expect(await openRow(julyOf(canvas, 'Monthly scans'))).toEqual([
      'Counted through Jul 31, 2026.',
      'The number was 100, set on Jun 18.',
    ])
    // A count that could not be read was counted through no day.
    await expect(await openRow(julyOf(canvas, 'Lobby ratings'))).toEqual([
      'The number was 100, set on Jun 18.',
    ])
    // An average's number is in tenths.
    await expect(await openRow(julyOf(canvas, 'Spa average'))).toContain(
      'The number was 4.5, set on Jun 18.',
    )
  },
}

/** No room is lost sideways on a phone. */
const fitsTheWidth: Story['play'] = async ({ canvasElement }) => {
  const page = canvasElement.ownerDocument.documentElement
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
}

/** The same states on the light surface; axe checks both themes. */
export const AllEvidenceStatesLight: Story = {
  ...AllEvidenceStates,
  parameters: { theme: 'light' },
}

/** The same states at each width the page is read at; the words stay the same. */
export const AllEvidenceStatesNarrowPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async (context) => {
    await AllEvidenceStates.play?.(context)
    await fitsTheWidth(context)
  },
}

export const AllEvidenceStatesPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async (context) => {
    await AllEvidenceStates.play?.(context)
    await fitsTheWidth(context)
  },
}

export const AllEvidenceStatesTablet: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const AllEvidenceStatesDesktop: Story = {
  ...AllEvidenceStates,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

/** One is singular, and a large count is grouped, in the figure and in the number. */
export const OneAndThousands: Story = {
  args: { matrix: ONE_AND_THOUSANDS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const one = julyOf(canvas, 'Monthly ratings')
    const thousands = julyOf(canvas, 'Front desk scans')
    await expect(within(one).getByText('1 of 1', { exact: true })).toBeVisible()
    await expect(
      within(thousands).getByText('1,234 of 1,200', { exact: true }),
    ).toBeVisible()
    await expect(await openRow(thousands)).toEqual([
      'Counted through Jul 31, 2026.',
      'The number was 1,200, set on Jun 18.',
    ])
    await expect(canvas.queryByText(/1234|1200\b/u)).toBeNull()
  },
}

/** The number was set in an earlier year: the day prints its year. */
export const TargetSetInAnEarlierYear: Story = {
  args: { matrix: SET_IN_AN_EARLIER_YEAR },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await openRow(julyOf(canvas, 'Monthly scans'))).toContain(
      'The number was 100, set on Dec 18, 2025.',
    )
  },
}

/**
 * July was set at 150 and Marco changed it to 100 on the 20th: the row is judged
 * against 100, and its details name who changed it, the day, how many times it
 * changed and the number it started at. A month nobody changed carries no such line.
 */
export const AChangedMonthNamesWhoChangedIt: Story = {
  args: { matrix: CHANGED_IN_JULY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const changed = await openRow(julyOf(canvas, 'Monthly scans'))
    await expect(changed).toContain(
      'Changed by Marco Rossi on Jul 20 (2 changes), started at 150',
    )
    const unchanged = await openRow(julyOf(canvas, 'Breakfast scans'))
    await expect(unchanged.some((line) => line.startsWith('Changed'))).toBe(false)
    await expect(canvas.getAllByText(/^Changed /u)).toHaveLength(1)
  },
}

/** A corrected month says so, last among its details. */
export const ACorrectedMonth: Story = {
  args: { matrix: CORRECTED_MONTH },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = await openRow(julyOf(canvas, 'Monthly scans'))
    await expect(details.at(-1)).toBe('Corrected on Aug 3.')
    await expect(details).toHaveLength(3)
  },
}

const BARS = 'Scans each month. The short line is that month’s number.'

/** Four months of one goal: a bar for each against its own number, and a row each, newest first. */
export const MonthsAsBars: Story = {
  args: { matrix: FOUR_MONTHS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bars = barsOf(canvas, BARS)
    const may = 'May 2026: 80 of 100. Missed by 20.'
    const august = 'August 2026: 7 of 100. The final figure is on its way.'
    // Oldest first, as the list a screen reader reads.
    await expect(barLines(bars)).toEqual([
      may,
      'June 2026: 120 of 100. Met.',
      'July 2026: 90 of 100. Missed by 10.',
      august,
    ])
    await expectBarsReadByKeyboard(bars, {
      hint: 'Hover or tap a bar to read that month.',
      first: may,
      last: august,
    })
    // The rows under them, newest first.
    const months = monthsOf(canvas, 'Each month of Monthly scans')
    await expect(
      months
        .getAllByRole('button')
        .map((row) => /^[A-Za-z]+ \d{4}/u.exec(row.textContent ?? '')?.[0]),
    ).toEqual(['August 2026', 'July 2026', 'June 2026', 'May 2026'])
  },
}

/** A goal with one month has no bars: one compares nothing. */
export const OneMonthHasNoBars: Story = {
  args: { matrix: CORRECTED_MONTH },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('figure')).toBeNull()
  },
}
