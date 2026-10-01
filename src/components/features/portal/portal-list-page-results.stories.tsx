// The Portals page with its results (boards 01, 10 and 11): the strip, the
// measure columns, the group heads' own figures, "Too few", and what the page
// says while the results load, fail, or are not offered to this reader.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ControlledPage, baseArgs } from './portal-list-page-stories-data'
import {
  indexOverviewResults,
  type PortalOverviewResultsState,
} from './portal-overview/portal-overview-results'
import { avelaResults } from './portal-overview/portal-overview-results-fixtures'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof ControlledPage> = {
  title: 'Portal/PortalListPage/Results',
  component: ControlledPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof ControlledPage>

const READY: PortalOverviewResultsState = {
  status: 'ready',
  index: indexOverviewResults(avelaResults()),
}

const controls = (state: PortalOverviewResultsState) => ({
  state,
  timeRange: '30d' as const,
  onTimeRangeChange: fn(),
  onRetry: fn(),
})

const withResults = { ...baseArgs, results: controls(READY) }

/** A row of the table, found by the Portal's name in its row header. */
const rowOf = (canvas: ReturnType<typeof within>, name: string) => {
  const row = canvas.getByRole('link', { name }).closest('tr')
  if (!row) throw new Error(`No table row for ${name}`)
  return within(row)
}

export const Default: Story = { args: withResults }

export const StripShowsTheFiveMeasures: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const strip = within(within(canvasElement).getByLabelText('Portal results'))
    await expect(strip.getByText('Qualified scans')).toBeInTheDocument()
    await expect(strip.getByText('1,607')).toBeInTheDocument()
    await expect(strip.getByText('+117 vs the 30 days before')).toBeInTheDocument()
    await expect(strip.getByText('450')).toBeInTheDocument()
    await expect(strip.getByText('28% of scans')).toBeInTheDocument()
    await expect(strip.getByText('236')).toBeInTheDocument()
    await expect(strip.getByText('15% of scans')).toBeInTheDocument()
    await expect(strip.getByText('36')).toBeInTheDocument()
  },
}

export const GroupHeadsCarryAllFiveMeasures: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const table = within(
      within(canvasElement).getByRole('table', { name: /portals at avela resort/i }),
    )
    const head = within(
      table.getByRole('button', { name: 'Portals in Pool side' }).closest('tr')!,
    )
    for (const figure of ['698', '209', '4.5', '116', '13']) {
      await expect(head.getByText(figure)).toBeInTheDocument()
    }
    await expect(head.getByText(/3 portals/)).toBeInTheDocument()
  },
}

export const PortalRowsSayTooFewInsteadOfAnAverage: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rooms = rowOf(canvas, 'Guest rooms')
    await expect(rooms.getByText('Too few')).toBeInTheDocument()
    await expect(
      rooms.getByText(/4 ratings, needs 5 to show an average/),
    ).toBeInTheDocument()
    // The counts beside it are real.
    await expect(rooms.getByText('38')).toBeInTheDocument()
    await expect(rowOf(canvas, 'Pool & Terrace').getByText('4.4')).toBeInTheDocument()
  },
}

export const DraftHasNoResultsYet: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const bar = rowOf(within(canvasElement), 'Pool bar')
    await expect(bar.getByText('No results until it’s published')).toBeInTheDocument()
    // The stacked card carries no summary line for it either.
    await expect(bar.queryByText(/qualified scans/)).toBeNull()
  },
}

export const SortsByQualifiedScans: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const order = () =>
      canvas
        .getAllByRole('link', { name: /^(Reception|Guest rooms)$/ })
        .map((link) => link.textContent)
    // Name order first: Guest rooms before Reception.
    await expect(order()).toEqual(['Guest rooms', 'Reception'])
    await userEvent.click(canvas.getByRole('button', { name: /sort: name/i }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', {
        name: 'Qualified scans',
      }),
    )
    await expect(order()).toEqual(['Reception', 'Guest rooms'])
    // Pool side (698) now leads Front of house (558).
    const heads = canvas.getAllByRole('button', { name: /^Portals in / })
    await expect(heads.map((head) => head.getAttribute('aria-label'))).toEqual([
      'Portals in Pool side',
      'Portals in Front of house',
      'Portals in Not in a group',
    ])
  },
}

export const ChangesTheWindow: Story = {
  args: withResults,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Time range' }))
    const options = await within(document.body).findAllByRole('option')
    await expect(options.map((option) => option.textContent)).toEqual([
      'Last 7 days',
      'Last 30 days',
      'Last 60 days',
      'Last 90 days',
    ])
    await userEvent.click(options[0]!)
    await expect(args.results?.onTimeRangeChange).toHaveBeenCalledWith('7d')
  },
}

/** A new window is loading: the figures on screen are the previous window's, and say so. */
export const NewWindowLoadingMarksEveryFigureBusy: Story = {
  args: { ...baseArgs, results: { ...controls(READY), busy: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: /portals at avela resort/i })
    const figures = table.closest('[aria-busy]')
    await expect(figures).toHaveAttribute('aria-busy', 'true')
    await expect(
      canvas.getByLabelText('Portal results').closest('[aria-busy]'),
    ).toHaveAttribute('aria-busy', 'true')
  },
}

export const NamesTheWindowAndTheFloor: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('1–30 Sep, Europe/Sofia time · all portals'),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText(
        'Last 30 days, Europe/Sofia time · an average needs 5 private ratings',
      ),
    ).toBeInTheDocument()
  },
}

/** The strip's one non-result: what waits in the Inbox, opened filtered by the Property. */
export const InboxWaitingLinksToTheInbox: Story = {
  args: { ...withResults, inboxWaiting: 5 },
  play: async ({ canvasElement }) => {
    const strip = within(within(canvasElement).getByRole('region', { name: 'Results' }))
    const link = strip.getByRole('link', { name: '5 waiting in Inbox' })
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/inbox')
    await expect(href.searchParams.get('propertyId')).toBe('prop-1')
    await expect(href.searchParams.get('queue')).toBe('open')
    // There is no "Open results": the strip is already the results.
    await expect(strip.queryByRole('link', { name: /open results/i })).toBeNull()
  },
}

export const NothingWaitingSaysNothing: Story = {
  args: { ...withResults, inboxWaiting: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/waiting in Inbox/)).toBeNull()
  },
}

export const InboxCountNotReadSaysNothing: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/waiting in Inbox/)).toBeNull()
  },
}

export const Loading: Story = {
  args: { ...baseArgs, results: controls({ status: 'loading' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The list does not wait for the figures.
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
    await expect(canvas.queryByText('1,607')).toBeNull()
  },
}

export const Failed: Story = {
  args: { ...baseArgs, results: controls({ status: 'failed' }) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/results couldn’t be loaded/i)).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }))
    await expect(args.results?.onRetry).toHaveBeenCalled()
  },
}

export const NotOfferedToThisReader: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Portal results')).toBeNull()
    await expect(
      canvas.queryByRole('columnheader', { name: /qualified scans/i }),
    ).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /sort: name/i }))
    await expect(
      within(document.body).queryByRole('menuitemradio', { name: 'Qualified scans' }),
    ).toBeNull()
  },
}

// Both lines are in the document whatever the width: the Vitest story runner compiles no
// Tailwind, so this story proves the summary line's words, not that it is the one shown at
// 390 px. Which of the two layouts shows at which width is held in
// `e2e/storybook-metrics/portal-overview.metrics.ts`, where Tailwind is compiled.
export const Phone: Story = {
  args: withResults,
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('412 qualified scans · 4.4 ★ from 118')).toBeVisible()
    await expect(canvas.getByText('698 scans · 4.5 ★ from 209')).toBeVisible()
  },
}
