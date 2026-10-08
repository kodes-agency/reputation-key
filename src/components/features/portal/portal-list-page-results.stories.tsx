// The Portals page with its results (boards 01, 10 and 11): the strip, the
// measure columns, the group heads' own figures, "Too few", and what the page
// says while the results load, fail, or are not offered to this reader.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
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
    // The reason is one a keyboard and a finger can ask for, not a title on a span.
    const tooFew = rooms.getByRole('button', { name: /too few/i })
    await expect(tooFew).toHaveTextContent('Too few')
    await userEvent.click(tooFew)
    await expect(
      await screen.findByText(/4 ratings, needs 5 to show an average/),
    ).toBeVisible()
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
    const range = canvas.getByRole('radiogroup', { name: 'Time range' })
    const options = within(range).getAllByRole('radio')
    await expect(options.map((option) => option.textContent)).toEqual([
      '7 days',
      '30 days',
      '60 days',
      '90 days',
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
        /Last 30 days, (Europe\/)?Sofia time · an average needs 5 private ratings/,
      ),
    ).toBeInTheDocument()
  },
}

// The headline term is one tap away from the column that sorts by it and from the
// line under the table.
export const QualifiedScansIsExplained: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = within(canvas.getByRole('table', { name: /portals at avela resort/i }))
    await userEvent.click(
      table.getByRole('button', { name: 'What qualified scans means' }),
    )
    await expect(
      await screen.findByText(/counted once per guest in 24 hours/),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(
      canvas.getByRole('button', { name: 'What a qualified scan is' }),
    )
    await expect(
      await screen.findByText(/bots and refreshes are not counted/i),
    ).toBeVisible()
  },
}

// Spa & thermal pools has a code from before scans were counted. Its scans are a
// dash with the reason, never the zero the read answers with; its card prints no
// "0 qualified scans"; and the strip says its total leaves that Portal out.
export const ScansNobodyCountedAreADashNotAZero: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spa = rowOf(canvas, 'Spa & thermal pools')
    const dash = spa.getByRole('button', {
      name: 'Qualified scans: Not counted: older code',
    })
    await expect(dash).toHaveTextContent('—')
    await expect(spa.queryByText(/qualified scans/)).toBeNull()
    await userEvent.click(dash)
    await expect(await screen.findByText('Not counted: older code.')).toBeVisible()
    // The rest of its row is counted: only scans are missing.
    await expect(spa.getByText('91')).toBeInTheDocument()

    const note = within(canvas.getByRole('region', { name: 'Results' }))
    await expect(note.getByText(/aren’t in these figures/)).toBeInTheDocument()
    const link = note.getByRole('link', { name: 'Open Share for Spa & thermal pools' })
    // The same cost the row's own line names: a new code means a new print.
    await expect(link).toHaveTextContent('Replace the code on Share (needs reprinting)')
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/properties/prop-1/portals/p-spa')
    await expect(href.searchParams.get('tab')).toBe('share')
  },
}

/** The Private notes cell's follow-up: the notes still waiting in the Inbox, filtered by the Property. */
export const InboxWaitingLinksToTheInbox: Story = {
  args: { ...withResults, inboxWaiting: 5 },
  play: async ({ canvasElement }) => {
    const strip = within(within(canvasElement).getByRole('region', { name: 'Results' }))
    const link = strip.getByRole('link', { name: '5 waiting in Inbox' })
    // It is the Private notes cell's own line, not a header control.
    const notes = strip.getByText('Private notes').closest('div')
    await expect(notes).not.toBeNull()
    await expect(notes?.contains(link)).toBe(true)
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/inbox')
    await expect(href.searchParams.get('propertyId')).toBe('prop-1')
    await expect(href.searchParams.get('queue')).toBe('feedback')
    // A tap target on a phone, by the Button's own minimum.
    await expect(link.className).toContain('max-md:min-h-(--control-touch)')
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
