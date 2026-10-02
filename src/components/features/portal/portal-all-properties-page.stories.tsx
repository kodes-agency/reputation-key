// The All properties page (board 10): the Organization's results strip, every
// Property headed by its own subtotal with its Portals under it, and what the
// page says while the results load, fail or are not offered to this reader.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  PortalAllPropertiesPage,
  type PortalAllPropertiesPageProps,
} from './portal-all-properties-page'
import {
  allPropertiesMembers,
  allPropertiesProperties,
  allPropertiesResults,
  allPropertiesRows,
} from './portal-overview/portal-all-properties-fixtures'
import { COLLAPSED_PROPERTIES_STORAGE_KEY } from './portal-overview/collapsed-properties-store'
import {
  indexOverviewResults,
  type PortalOverviewResultsState,
} from './portal-overview/portal-overview-results'
import type { AllPropertiesSearch } from './portal-overview/portal-overview-search-schema'
import type { Action } from '#/components/hooks/use-action'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'

const action = <TInput,>(): Action<TInput> =>
  Object.assign(async (_input: TInput) => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

// The page is presentational: the route owns the URL. A story keeps the search in
// state so the toolbar and the pager behave as they do in the route.
function ControlledPage(
  props: Omit<PortalAllPropertiesPageProps, 'search' | 'onSearchChange'>,
) {
  const [search, setSearch] = useState<AllPropertiesSearch>({})
  return <PortalAllPropertiesPage {...props} search={search} onSearchChange={setSearch} />
}

const meta: Meta<typeof ControlledPage> = {
  title: 'Portal/PortalAllPropertiesPage',
  component: ControlledPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof ControlledPage>

const READY: PortalOverviewResultsState = {
  status: 'ready',
  index: indexOverviewResults(allPropertiesResults()),
}

const controls = (state: PortalOverviewResultsState) => ({
  state,
  timeRange: '30d' as const,
  onTimeRangeChange: fn(),
  onRetry: fn(),
})

const baseArgs = {
  rows: allPropertiesRows(),
  properties: allPropertiesProperties,
  newPortalProperties: allPropertiesProperties.map(({ id, name }) => ({ id, name })),
  members: allPropertiesMembers,
  organizationName: 'Avela Hospitality',
  organizationWide: true,
  archiveMutation: action<{ data: { portalId: string; publicationState: 'archived' } }>(),
  restoreMutation: action<{ data: { portalId: string; publicationState: 'disabled' } }>(),
  disableMutation: action<{ data: { portalId: string; publicationState: 'disabled' } }>(),
}
const withResults = { ...baseArgs, results: controls(READY) }

const tableOf = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByRole('table', { name: 'Portals at all properties' }))

/** A Property's head row, found by its fold button. */
const headOf = (canvas: ReturnType<typeof within>, property: string) => {
  const row = tableOf(canvas)
    .getByRole('button', { name: `Portals in ${property}` })
    .closest('tr')
  if (!row) throw new Error(`No head row for ${property}`)
  return within(row)
}

export const Default: Story = { args: withResults }

export const SaysWhatTheOrganizationHolds: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('All 3 properties in Avela Hospitality · 11 portals'),
    ).toBeInTheDocument()
  },
}

export const StripIsTheOrganizationTotal: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const strip = within(canvas.getByLabelText('Portal results'))
    for (const text of [
      'Qualified scans',
      '3,420',
      '+212 vs the 30 days before',
      '951',
      '28% of scans',
      'Average private rating',
      '498',
      '15% of scans',
      '71',
    ]) {
      await expect(strip.getByText(text)).toBeInTheDocument()
    }
    await expect(canvas.getByText('all properties')).toBeInTheDocument()
    await expect(
      canvas.getByText(
        'Last 30 days · each property’s local time · an average needs 5 private ratings · collapsed properties stay collapsed for you',
      ),
    ).toBeInTheDocument()
    // Google's own review average is not part of these totals.
    await expect(strip.queryByText(/google review/i)).toBeNull()
  },
}

export const PropertyHeadsCarryTheirOwnSubtotals: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const avela = headOf(canvas, 'Avela Resort')
    for (const figure of ['1,607', '450', '4.4', '236', '36']) {
      await expect(avela.getByText(figure)).toBeInTheDocument()
    }
    await expect(avela.getByText(/6 portals/)).toBeInTheDocument()
    await expect(
      headOf(canvas, 'The Harbor Hotel').getByText('1,108'),
    ).toBeInTheDocument()
    await expect(headOf(canvas, 'Forma Kitchen').getByText('705')).toBeInTheDocument()
  },
}

export const PropertyNameOpensItsOwnPortals: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const link = headOf(within(canvasElement), 'Avela Resort').getByRole('link', {
      name: 'Avela Resort',
    })
    await expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/\/properties\/prop-avela\/portals$/),
    )
  },
}

export const SaysWhenAGoogleLinkNeedsReconnecting: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Once for the stacked layout, once for the table: CSS shows one of them.
    await expect(
      headOf(canvas, 'The Harbor Hotel').getAllByText('Google link needs reconnecting'),
    ).not.toHaveLength(0)
    await expect(headOf(canvas, 'Avela Resort').queryByText(/google link/i)).toBeNull()
  },
}

export const PortalRowsKeepTheirOwnLinks: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const table = tableOf(within(canvasElement))
    const row = table.getByRole('link', { name: 'Rooms' }).closest('tr')
    if (!row) throw new Error('No row for Rooms')
    // Rooms is The Harbor Hotel's, not Avela Resort's.
    await expect(within(row).getByRole('link', { name: 'Edit Rooms' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/properties\/prop-harbor\/portals\/h-rooms/),
    )
    await expect(within(row).getByText('4.5')).toBeInTheDocument()
  },
}

export const OnlyAPropertyHeadsItsWholeBody: Story = {
  args: {
    ...withResults,
    rows: allPropertiesRows({ harborGroups: true }),
    results: controls({
      status: 'ready',
      index: indexOverviewResults(allPropertiesResults({ harborGroups: true })),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A rowgroup header covers the whole `<tbody>`: the Property's head is one;
    // its groups' heads (Harbor's "Front of house") head only their own row, so a
    // cell is not also described by the name of another group in the Property.
    const headerOf = (name: string) =>
      tableOf(canvas)
        .getByRole('button', { name: `Portals in ${name}` })
        .closest('th')
    await expect(headerOf('The Harbor Hotel')).toHaveAttribute('scope', 'rowgroup')
    await expect(headerOf('Front of house')).toHaveAttribute('scope', 'row')
  },
}

export const FoldingAPropertyHidesItsPortalsAndIsRemembered: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    try {
      localStorage.removeItem(COLLAPSED_PROPERTIES_STORAGE_KEY)
      await expect(canvas.getByRole('link', { name: 'Dining room' })).toBeInTheDocument()
      await userEvent.click(
        canvas.getByRole('button', { name: 'Portals in Forma Kitchen' }),
      )
      await expect(canvas.queryByRole('link', { name: 'Dining room' })).toBeNull()
      // The Property's own subtotal stays: that is what a folded head is for.
      await expect(headOf(canvas, 'Forma Kitchen').getByText('705')).toBeInTheDocument()
      await expect(localStorage.getItem(COLLAPSED_PROPERTIES_STORAGE_KEY)).toContain(
        'prop-forma',
      )
      await userEvent.click(
        canvas.getByRole('button', { name: 'Portals in Forma Kitchen' }),
      )
      await expect(canvas.getByRole('link', { name: 'Dining room' })).toBeInTheDocument()
    } finally {
      localStorage.removeItem(COLLAPSED_PROPERTIES_STORAGE_KEY)
    }
  },
}

export const SearchFindsAPropertyByName: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search portals or properties' }),
      'forma',
    )
    await expect(canvas.getByRole('link', { name: 'Dining room' })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Takeaway' })).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Reception' })).toBeNull()
    await expect(canvas.getByText('2 of 11')).toBeInTheDocument()
  },
}

export const SearchFindsAPortalWhicheverPropertyHasIt: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search portals or properties' }),
      'bar',
    )
    await expect(canvas.getByRole('link', { name: 'Pool bar' })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Harbour bar' })).toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: 'Portals in Forma Kitchen' }),
    ).toBeNull()
  },
}

export const NothingMatches: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search portals or properties' }),
      'zzz',
    )
    await expect(canvas.getByText('No portals match')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }))
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
  },
}

export const SortsPropertiesByQualifiedScans: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const order = () =>
      canvas
        .getAllByRole('button', { name: /^Portals in / })
        .map((button) => button.getAttribute('aria-label'))
    // Name order first: Forma Kitchen before The Harbor Hotel.
    await expect(order()).toEqual([
      'Portals in Avela Resort',
      'Portals in Forma Kitchen',
      'Portals in The Harbor Hotel',
    ])
    await userEvent.click(canvas.getByRole('button', { name: /sort: name/i }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', {
        name: 'Qualified scans',
      }),
    )
    await expect(order()).toEqual([
      'Portals in Avela Resort',
      'Portals in The Harbor Hotel',
      'Portals in Forma Kitchen',
    ])
  },
}

export const OffersNeitherFilterNorGrouping: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /^show:/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^group by:/i })).toBeNull()
    await expect(canvas.getByRole('button', { name: /^sort:/i })).toBeInTheDocument()
  },
}

/** One Property has a group: its head holds the group, and the Portals in none, under it. */
export const AGroupShowsUnderItsProperty: Story = {
  args: {
    ...withResults,
    rows: allPropertiesRows({ harborGroups: true }),
    results: controls({
      status: 'ready',
      index: indexOverviewResults(allPropertiesResults({ harborGroups: true })),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = within(
      tableOf(canvas)
        .getByRole('button', { name: 'Portals in Front of house' })
        .closest('tr')!,
    )
    await expect(group.getByText('888')).toBeInTheDocument()
    await expect(group.getByText(/2 portals/)).toBeInTheDocument()
    const rest = within(
      tableOf(canvas)
        .getByRole('button', { name: 'Portals in Not in a group' })
        .closest('tr')!,
    )
    await expect(rest.getByText('220')).toBeInTheDocument()
    // Avela Resort has no groups, so its Portals sit straight under its head.
    await expect(
      tableOf(canvas).getAllByRole('button', { name: 'Portals in Not in a group' }),
    ).toHaveLength(1)
  },
}

export const NewPortalAsksWhichProperty: Story = {
  args: withResults,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /new portal/i }))
    const menu = within(document.body)
    for (const name of ['Avela Resort', 'The Harbor Hotel', 'Forma Kitchen']) {
      await expect(await menu.findByRole('menuitem', { name })).toHaveAttribute(
        'href',
        expect.stringMatching(/\/portals\/new$/),
      )
    }
  },
}

export const NewPortalGoesStraightToTheOnlyProperty: Story = {
  args: {
    ...withResults,
    newPortalProperties: [{ id: 'prop-avela', name: 'Avela Resort' }],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('link', { name: /new portal/i }),
    ).toHaveAttribute('href', '/properties/prop-avela/portals/new')
  },
}

export const Loading: Story = {
  args: { ...baseArgs, results: controls({ status: 'loading' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The list does not wait for the figures.
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
    await expect(canvas.queryByText('3,420')).toBeNull()
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
    // Each Property head is still a head, with its count and no figures.
    await expect(
      headOf(canvas, 'Avela Resort').getByText(/6 portals/),
    ).toBeInTheDocument()
    await expect(headOf(canvas, 'Avela Resort').queryByText('1,607')).toBeNull()
  },
}

export const NoPortalsAnywhere: Story = {
  args: { ...baseArgs, rows: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No portals yet')).toBeInTheDocument()
  },
}

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
    // Both lines are in the document whatever the width: the Vitest story runner
    // compiles no Tailwind. Which layout shows at which width is held in
    // `e2e/storybook-metrics/portal-all-properties.metrics.ts`.
    await expect(canvas.getByText('1,607 scans · 4.4 ★ from 450')).toBeVisible()
    await expect(canvas.getByText('412 qualified scans · 4.4 ★ from 118')).toBeVisible()
  },
}
