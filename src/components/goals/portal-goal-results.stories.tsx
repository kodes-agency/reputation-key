// The Portal goal results page (PLAN PG-18; ADR 0068 amended 2026-11-01): Seaview
// Hotel on Dec 3, 2026. `Months`: the Monthly portal goal in one card titled by its
// name, a bar for each month against its own number, then a row for each month, newest
// first ("41 of 40", Met, Missed by 4), each opening the day its figure was counted
// through and who set the number. `Ended`: the scans goal stopped on Sep 12 is the same
// goal by name, so its months sit in the same card under what they counted; then the
// goals that have ended, newest end first: Reception's ended last year (the day prints
// its year) and a Spa goal ended before the day was kept, each opening its goal. At
// 320, 390, 820 and 1440 px and on the light theme. Arriving at `#ended` from the
// Portal goals section's link hands the list's title the focus. The Storybook Vitest
// project compiles no Tailwind, so there the plays assert words, roles, the heading
// outline, links and the focus; where Tailwind is compiled they also measure that
// every result is inside its row and nothing scrolls sideways. The list's own states
// are `portal-goal-results-list.stories.tsx`'.
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { tailwindIsCompiled } from '../../../.storybook/tailwind-compiled'
import { PortalGoalResults } from './portal-goal-results'
import {
  MONTHLY_GOAL,
  RESULTS_NOW,
  SEAVIEW,
  SEAVIEW_GOALS,
  personName,
  resultsOf,
} from './portal-goal-results.stories.fixtures'
import { barLines, barsOf } from './portal-goal.stories.play'

const meta: Meta<typeof PortalGoalResults> = {
  title: 'Goals/PortalGoalResults',
  component: PortalGoalResults,
  parameters: { layout: 'padded' },
  args: {
    propertyId: SEAVIEW.propertyId,
    propertyName: SEAVIEW.name,
    ...resultsOf(SEAVIEW_GOALS),
    now: RESULTS_NOW,
    personName,
  },
}

export default meta
type Story = StoryObj<typeof meta>
type Canvas = ReturnType<typeof within>

/**
 * The page's headings, in document order, as "h2 Monthly portal goal", once it is
 * drawn: in a compiled Storybook the story's router draws it after the play
 * starts.
 */
async function outline(canvasElement: HTMLElement): Promise<string[]> {
  await within(canvasElement).findByRole('heading', { level: 1 })
  return [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )
}

/** A goal's months, by the goal's name or by what a block of them counted. */
const monthsOf = (canvas: Canvas, name: string) =>
  within(canvas.getByRole('list', { name }))

/** Each month's row: its month, then what the row says of its figure and its verdict. */
async function expectMonths(
  list: Canvas,
  months: readonly (readonly [month: string, figure: string, verdict: string])[],
) {
  const rows = list.getAllByRole('button')
  await expect(rows).toHaveLength(months.length)
  for (const [index, [month, figure, verdict]] of months.entries()) {
    const row = rows[index]
    if (row === undefined) throw new Error(`expected a row for ${month}`)
    await expect(row.textContent?.startsWith(month)).toBe(true)
    await expect(within(row).getByText(figure, { exact: true })).toBeVisible()
    await expect(within(row).getByText(verdict, { exact: true })).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  }
}

export const Months: Story = {
  args: resultsOf([MONTHLY_GOAL]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The goal's name is the card's title: no "Monthly results", no table per month.
    await expect(await outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly portal goal',
    ])
    await expect(canvas.queryByRole('table')).toBeNull()
    // October met, November missed by 4; December has no figure yet, so no bar.
    await expect(
      barLines(
        barsOf(
          canvas,
          'Private ratings each month. The short line is that month’s number.',
        ),
      ),
    ).toEqual(['October 2026: 41 of 40. Met.', 'November 2026: 36 of 40. Missed by 4.'])
    const months = monthsOf(canvas, 'Each month of Monthly portal goal')
    await expectMonths(months, [
      ['December 2026', '–', 'The final figure is on its way'],
      ['November 2026', '36 of 40', 'Missed by 4'],
      ['October 2026', '41 of 40', 'Met'],
    ])
    // One tap on a row: when its figure was final and who set the number.
    await userEvent.click(months.getByRole('button', { name: /^November 2026/u }))
    await expect(canvas.getByText('Counted through Nov 30, 2026.')).toBeVisible()
    await expect(canvas.getByText('The number was 40, set on Sep 21.')).toBeVisible()
    // No goal has ended: the page has no part for them.
    await expect(canvas.queryByRole('heading', { name: 'Ended portal goals' })).toBeNull()
  },
}

export const Ended: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly portal goal',
      'h2 Ended portal goals',
    ])
    // The scans goal it took over from has the same name: its months are in the same
    // card, under what each block of months counted.
    await expectMonths(monthsOf(canvas, 'Counted private ratings'), [
      ['December 2026', '–', 'The final figure is on its way'],
      ['November 2026', '36 of 40', 'Missed by 4'],
      ['October 2026', '41 of 40', 'Met'],
    ])
    await expectMonths(monthsOf(canvas, 'Counted scans'), [
      ['September 2026', '90 of 120', 'Missed by 30'],
      ['August 2026', '130 of 120', 'Met'],
    ])
    // Where the Portal goals section's "Ended portal goals (3)" lands.
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Ended portal goals' }),
    ).toHaveAttribute('id', 'ended')
    const goals = within(canvas.getByRole('list', { name: 'Ended portal goals' }))
    await expect(
      goals.getAllByRole('listitem').map((item) => item.textContent ?? ''),
    ).toEqual([
      'Monthly portal goalScans · target 120 · Seaview HotelEnded on Sep 12',
      'Reception ratingsPrivate ratings · target 20 · ReceptionEnded on Nov 12, 2025',
      // Ended before the day a goal ends on was kept: no day to say.
      'Spa scansScans · target 60 · SpaEnded',
    ])
    await expect(goals.getByRole('link', { name: 'Reception ratings' })).toHaveAttribute(
      'href',
      '/properties/property-seaview/goals/goal-reception',
    )
  },
}

/**
 * Every row reads whole at this width. Compiled, it is measured: the page does not
 * scroll sideways, and each row's figure and verdict stay inside the row. Without
 * Tailwind there is no layout to measure, so the rows are checked to be what the
 * layout is made of: one button each, closed until asked.
 */
async function expectEveryResultInView(canvasElement: HTMLElement) {
  const rows = within(canvasElement)
    .getAllByRole('button')
    .filter((button) => button.closest('[data-slot="portal-goal-results-goal"]') !== null)
  await expect(rows).toHaveLength(5)
  for (const row of rows) await expect(row).toHaveAttribute('aria-expanded', 'false')
  if (!tailwindIsCompiled()) return
  const page = canvasElement.ownerDocument.documentElement
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
  for (const row of rows) {
    const edge = row.getBoundingClientRect().right
    for (const part of row.querySelectorAll<HTMLElement>('span')) {
      await expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 0.5)
    }
  }
}

export const Phone320: Story = {
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
  play: async (context) => {
    await Ended.play?.(context)
    await expectEveryResultInView(context.canvasElement)
  },
}

export const Phone390: Story = {
  ...Phone320,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
}

export const OnATablet: Story = {
  ...Phone320,
  parameters: { viewport: { defaultViewport: 'tablet' } },
}

export const OnADesktop: Story = {
  ...Phone320,
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
}

export const Light: Story = {
  ...Phone320,
  parameters: { theme: 'light' },
}

type ResultsProps = Parameters<typeof PortalGoalResults>[0]

/** The ways to `#ended` and away, each a button: its words and where it goes. */
const ARRIVALS = [
  { label: 'Leave', hash: 'elsewhere' },
  { label: 'Arrive by the address', hash: 'ended' },
  {
    label: 'Arrive asking for the focus',
    hash: 'ended',
    state: { focusEndedPortalGoals: true },
  },
] as const

/**
 * A page drawn only at `#ended`, so each arrival draws it afresh, as the results
 * page is drawn after the Goals page the link left.
 */
function Arrivals(props: ResultsProps) {
  const navigate = useNavigate()
  const atEnded = useRouterState({ select: (state) => state.location.hash === 'ended' })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {ARRIVALS.map(({ label, ...to }) => (
          <Button key={label} onClick={() => void navigate({ to: '.', ...to })}>
            {label}
          </Button>
        ))}
      </div>
      {atEnded ? <PortalGoalResults {...props} /> : null}
    </div>
  )
}

/** The ended goals' title, once the page is drawn. */
const endedTitle = (canvasElement: HTMLElement) =>
  within(canvasElement).findByRole('heading', { level: 2, name: 'Ended portal goals' })

/**
 * "Ended portal goals (n)" asks for the focus (R-4): the list's title takes it.
 * An address typed or kept leaves the focus where the browser puts it.
 */
export const ArrivingAtEndedTakesTheFocusWhenAsked: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  render: (args) => <Arrivals {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Arrive by the address' }))
    const unasked = await endedTitle(canvasElement)
    // The page is drawn and its effects have run by the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await expect(unasked).not.toHaveFocus()

    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    await waitFor(() =>
      expect(canvas.queryByRole('heading', { name: 'Ended portal goals' })).toBeNull(),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Arrive asking for the focus' }),
    )
    const asked = await endedTitle(canvasElement)
    await waitFor(() => expect(asked).toHaveFocus())
  },
}
