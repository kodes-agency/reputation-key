// The Portal goal results page (PLAN PG-18): Seaview Hotel on Dec 3, 2026.
// `Months`: the Monthly portal goal's months as sections, newest first, each
// result in plain words. `Ended`: the scans goal stopped on Sep 12, Reception's
// goal ended last year (the day prints its year) and a Spa goal ended before
// the day was kept, newest end first, each opening its goal. At 320, 390, 820
// and 1440 px and on the light theme: below about 56rem of card the months'
// tables reflow into one block per result, so nothing is squeezed or left in a
// scroller. Arriving at `#ended` from the Portal goals section's link hands the
// list's title the focus. The Storybook Vitest project compiles no Tailwind, so
// there the plays assert words, roles, the heading outline, links, the focus and
// the reflow's classes; where Tailwind is compiled they also measure that every
// result is inside its card and nothing scrolls sideways.
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

/**
 * The page's headings, in document order, as "h2 Monthly results", once it is
 * drawn: in a compiled Storybook the story's router draws it after the play
 * starts.
 */
async function outline(canvasElement: HTMLElement): Promise<string[]> {
  await within(canvasElement).findByRole('heading', { level: 1 })
  return [...canvasElement.querySelectorAll('h1, h2, h3')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${heading.textContent ?? ''}`,
  )
}

export const Months: Story = {
  args: resultsOf([MONTHLY_GOAL]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly results',
      'h3 December 2026',
      'h3 November 2026',
      'h3 October 2026',
    ])
    await expect(
      canvas.getByText('Each month’s result for your portal goals.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Updating: the final figure is on its way.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Not met: 36 private ratings, the goal was 40.'),
    ).toBeVisible()
    await expect(
      canvas.getByText('Met: 41 private ratings, the goal was 40.'),
    ).toBeVisible()
    // No goal has ended: the page has no part for them.
    await expect(canvas.queryByRole('heading', { name: 'Ended portal goals' })).toBeNull()
  },
}

export const Ended: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await outline(canvasElement)).toEqual([
      'h1 Portal goal results',
      'h2 Monthly results',
      'h3 December 2026',
      'h3 November 2026',
      'h3 October 2026',
      'h3 September 2026',
      'h3 August 2026',
      'h2 Ended portal goals',
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

/** The words a month's result is told in, one per result. */
const RESULT_LINE = /^(Met|Not met|Updating):/u

/**
 * Every result reads whole at this width. Compiled, it is measured: no month's
 * table scrolls sideways (a scroller holding no control cannot be reached by
 * keyboard), and each result's badge and words stay inside its row. Without
 * Tailwind there is no layout to measure, so the reflow's parts are checked:
 * each month is a table named by its month that is drawn as blocks below the
 * card's `@4xl`, and each result names its columns for that block.
 */
async function expectEveryResultInView(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const tables = canvas.getAllByRole('table')
  await expect(
    tables.map((table) => table.getAttribute('aria-labelledby')),
  ).not.toContain(null)
  const results = canvas.getAllByRole('row').filter((row) => row.closest('tbody'))
  if (!tailwindIsCompiled()) {
    for (const table of tables) await expect(table).toHaveClass('block', '@4xl:table')
    for (const row of results) {
      for (const column of ['Measure and evidence', 'Result', 'Data through', 'Number']) {
        await expect(within(row).getByText(column)).toBeInTheDocument()
      }
    }
    return
  }
  for (const table of tables) {
    const scroller = table.closest<HTMLElement>('[data-slot="table-container"]')
    if (scroller === null) throw new Error('expected each month in its table container')
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
  }
  for (const row of results) {
    const edge = row.getBoundingClientRect().right
    const parts = [
      ...row.querySelectorAll<HTMLElement>('[data-slot="badge"]'),
      ...within(row).getAllByText(RESULT_LINE),
    ]
    for (const part of parts) {
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

/**
 * A page drawn only at `#ended`, so each arrival draws it afresh, as the results
 * page is drawn after the Goals page the link left.
 */
function Arrivals(props: ResultsProps) {
  const navigate = useNavigate()
  const hash = useRouterState({ select: (state) => state.location.hash })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button onClick={() => void navigate({ to: '.', hash: 'elsewhere' })}>
          Leave
        </Button>
        <Button onClick={() => void navigate({ to: '.', hash: 'ended' })}>
          Arrive by the address
        </Button>
        <Button
          onClick={() =>
            void navigate({
              to: '.',
              hash: 'ended',
              state: { focusEndedPortalGoals: true },
            })
          }
        >
          Arrive asking for the focus
        </Button>
      </div>
      {hash === 'ended' ? <PortalGoalResults {...props} /> : null}
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
