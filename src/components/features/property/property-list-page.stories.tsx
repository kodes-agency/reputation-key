// Properties — one table you can sort, filter and search
// (docs/plan/property-list-table.md). The page is presentational, so each story
// holds the URL search in state the way the route holds it in the URL.
// Routing and permissions come from decorators.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { withRole } from '../../../../.storybook/AuthedRouterDecorator'
import type { PropertySetupStep } from '#/contexts/reporting/application/public-api'
import {
  PropertyListPage,
  type PropertyComparison,
  type PropertyListPageProps,
  type PropertySetupProgress,
} from './property-list-page'
import type { PropertyListSearch } from './property-list-search-schema'
import type { PropertyListProperty } from './property-list-view'

type StoryArgs = Omit<PropertyListPageProps, 'search' | 'onSearchChange'> &
  Readonly<{ initialSearch?: PropertyListSearch }>

function ListStory({ initialSearch, ...props }: StoryArgs) {
  const [search, setSearch] = useState<PropertyListSearch>(initialSearch ?? {})
  return <PropertyListPage {...props} search={search} onSearchChange={setSearch} />
}

const meta: Meta<StoryArgs> = {
  title: 'Property/PropertyListPage',
  component: ListStory,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen w-full bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<StoryArgs>

const property = (
  id: string,
  name: string,
  overrides: Partial<PropertyListProperty> = {},
): PropertyListProperty => ({
  id,
  name,
  address: null,
  countryCode: null,
  googleBindingState: 'active',
  lifecycleState: 'active',
  ...overrides,
})

const properties: PropertyListProperty[] = [
  property('prop-harborline', 'Harborline Suites', {
    address: '1200 Ocean Front Walk, Los Angeles, CA 90291',
    countryCode: 'US',
  }),
  property('prop-elegance', 'Hotel Elegance', {
    address: 'улица „Петко Р. Славейков“ 54, Стара Загора, 6000',
    countryCode: 'BG',
  }),
  property('prop-kodes', 'KODES agency', { countryCode: 'BG' }),
  property('prop-initech', 'Initech Campus', {
    countryCode: 'GB',
    googleBindingState: 'unbound',
  }),
  property('prop-studio', 'Studio Priority', {
    address: 'ul. "General Gurko" 16, Sofia, 1000',
    countryCode: 'BG',
  }),
  property('prop-globex', 'Globex HQ', {
    countryCode: 'US',
    lifecycleState: 'suspended',
  }),
]

const removedProperty = property('prop-lakeside', 'Lakeside Annex', {
  countryCode: 'BG',
  lifecycleState: 'archived',
})

const figures = (
  avgRating: number | null,
  reviewCount: number,
  attention: Partial<PropertyComparison['attention']> = {},
): PropertyComparison => ({
  avgRating,
  reviewCount,
  attention: {
    total: 0,
    overdue: 0,
    itemsToTriage: 0,
    escalated: 0,
    goalsBehindPace: 0,
    ...attention,
  },
})

const comparison: ReadonlyMap<string, PropertyComparison> = new Map([
  [
    'prop-elegance',
    figures(3.9, 260, { total: 7, overdue: 3, itemsToTriage: 6, escalated: 1 }),
  ],
  ['prop-harborline', figures(4.3, 412, { total: 4, itemsToTriage: 4 })],
  ['prop-kodes', figures(5, 20, { total: 1, itemsToTriage: 1 })],
  // A week-one property in a fleet of established ones.
  ['prop-initech', figures(null, 0)],
  ['prop-studio', figures(5, 4)],
  ['prop-globex', figures(3.1, 26)],
])

const nextStep = (
  key: PropertySetupStep['key'],
  section: PropertySetupStep['section'],
  status: PropertySetupStep['status'] = 'pending',
): PropertySetupStep => ({ key, section, status, asked: false })

const progress = (
  completedCount: number,
  next: PropertySetupStep | null,
): PropertySetupProgress => ({ completedCount, stepCount: 7, nextStep: next })

const setup: ReadonlyMap<string, PropertySetupProgress> = new Map([
  ['prop-elegance', progress(6, nextStep('portal_published', 'portals'))],
  ['prop-harborline', progress(7, null)],
  ['prop-kodes', progress(5, nextStep('reply_voice', 'replies'))],
  ['prop-initech', progress(1, nextStep('google_linked', 'google'))],
  ['prop-studio', progress(4, nextStep('responsible_manager', 'people'))],
  ['prop-globex', progress(7, null)],
])

const ready: StoryArgs = {
  properties,
  comparison,
  fleet: 'ready',
  setup,
  setupState: 'ready',
}

const bodyRows = (canvas: ReturnType<typeof within>) =>
  canvas
    .getAllByRole('row')
    .filter((row: HTMLElement) => within(row).queryAllByRole('cell').length > 0)

export const Default: Story = {
  args: ready,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const p of properties) {
      // One DOM for every width: each name renders exactly once.
      expect(canvas.getByText(p.name)).toBeVisible()
      expect(canvas.getByRole('link', { name: p.name })).toHaveAttribute(
        'href',
        `/properties/${p.id}`,
      )
    }
    // Most work first.
    expect(within(bodyRows(canvas)[0]!).getByText('Hotel Elegance')).toBeVisible()
    expect(canvas.getByText('3.9')).toBeVisible()
    // A property with no ratings says so rather than showing a dash (row 12).
    expect(canvas.getByText('No ratings')).toBeVisible()
    expect(canvas.queryByText('—')).toBeNull()
    // The count opens the queue that holds it; overdue is its qualifier, not a part.
    expect(
      canvas.getByRole('link', {
        name: '7 need attention at Hotel Elegance: 3 overdue, 1 escalated',
      }),
    ).toHaveAttribute('href', '/properties/prop-elegance/reviews?queue=open')
    expect(
      canvas.getByRole('link', {
        name: 'Setup 1 of 7 at Initech Campus. Next: Link the Google Business Profile',
      }),
    ).toHaveAttribute('href', '/properties/prop-initech/settings/google')
    expect(
      canvas.getByRole('link', { name: 'Google not linked for Initech Campus' }),
    ).toHaveAttribute('href', '/properties/prop-initech/settings/google')
    expect(canvas.getByText('Paused')).toBeVisible()
    expect(canvas.getByText('6 properties · 1 paused')).toBeVisible()
    expect(
      canvas.getByText('Ratings and review counts are all-time.', { exact: false }),
    ).toBeVisible()
    // The slug and the IANA timezone left the list.
    expect(canvas.queryByText(/Los_Angeles|harborline$/)).toBeNull()
    // The org setup banner is gone; per-property setup carries it.
    expect(canvas.queryByText(/^Setup: \d of \d done$/)).toBeNull()
  },
}

export const DefaultLight: Story = { args: ready, parameters: { theme: 'light' } }

export const FiguresPending: Story = {
  args: {
    ...ready,
    comparison: new Map(),
    fleet: 'loading',
    setup: undefined,
    setupState: 'loading',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The order waits for the figures: name order until they arrive.
    expect(within(bodyRows(canvas)[0]!).getByText('Globex HQ')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Sort: Needs attention' })).toBeVisible()
    expect(canvas.queryByText(/all-time/)).toBeNull()
  },
}

export const FleetReadUnavailable: Story = {
  args: { ...ready, comparison: undefined, fleet: 'unavailable' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Still the list a manager came for, not a broken page — and no zeros.
    expect(canvas.getByText('Harborline Suites')).toBeVisible()
    expect(canvas.queryByRole('button', { name: /^Rating/ })).toBeNull()
    expect(canvas.queryByText('Needs attention')).toBeNull()
    expect(canvas.getByRole('button', { name: 'Sort: Name' })).toBeVisible()
    expect(canvas.queryByText(/Ratings and review counts/)).toBeNull()
  },
}

export const SetupUnavailable: Story = {
  args: { ...ready, setup: undefined, setupState: 'unavailable' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /^Setup/ })).toBeNull()
    expect(canvas.queryByText('Setup to finish')).toBeNull()
  },
}

export const SortByRating: Story = {
  args: ready,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rating = canvas.getByRole('button', { name: /^Rating/ })

    await userEvent.click(rating)
    expect(rating.closest('th')).toHaveAttribute('aria-sort', 'descending')
    // Two 5.0 ratings: the larger sample first.
    expect(within(bodyRows(canvas)[0]!).getByText('KODES agency')).toBeVisible()

    await userEvent.click(rating)
    expect(rating.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    expect(within(bodyRows(canvas)[0]!).getByText('Globex HQ')).toBeVisible()
    // A property without ratings stays last either way.
    expect(within(bodyRows(canvas).at(-1)!).getByText('Initech Campus')).toBeVisible()
  },
}

// The default sort is not in the URL; reversing it must still hold.
export const ReverseNeedsAttention: Story = {
  args: ready,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const header = canvas.getByRole('button', { name: /^Needs attention/ })
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending')

    await userEvent.click(header)
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    // Nothing waiting first, least set up first among those.
    expect(within(bodyRows(canvas)[0]!).getByText('Initech Campus')).toBeVisible()
    expect(within(bodyRows(canvas).at(-1)!).getByText('Hotel Elegance')).toBeVisible()
  },
}

export const ShowNeedsAttention: Story = {
  args: ready,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const strip = within(canvas.getByLabelText('Portfolio summary'))

    await userEvent.click(strip.getByRole('button', { name: /12\s*in 3 properties/ }))
    expect(bodyRows(canvas)).toHaveLength(3)
    expect(canvas.getByText('3 of 6')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Show: Needs attention' })).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }))
    expect(bodyRows(canvas)).toHaveLength(6)
  },
}

export const SearchByAddress: Story = {
  args: { ...ready, initialSearch: { q: 'стара загора' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(bodyRows(canvas)).toHaveLength(1)
    expect(canvas.getByText('Hotel Elegance')).toBeVisible()
  },
}

export const SearchNoMatch: Story = {
  args: { ...ready, initialSearch: { q: 'no such hotel' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('No properties match')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search and filter' }))
    expect(bodyRows(canvas)).toHaveLength(6)
  },
}

export const SetupWaitingOnAdmin: Story = {
  args: {
    ...ready,
    setup: new Map([
      ...setup,
      ['prop-initech', progress(1, nextStep('google_linked', 'google', 'needs_admin'))],
    ]),
  },
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Nothing the manager can do, so it says who can — and is not a link.
    expect(canvas.getByText('Waiting on an account admin')).toBeVisible()
    expect(canvas.queryByRole('link', { name: /Setup 1 of 7 at Initech/ })).toBeNull()
    expect(canvas.queryByRole('link', { name: /import/i })).not.toBeInTheDocument()
  },
}

export const Compact390: Story = {
  args: ready,
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const p of properties) expect(canvas.getAllByText(p.name)).toHaveLength(1)
  },
}

export const Compact320: Story = {
  args: ready,
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

// A single property: nothing to compare, so no summary and no controls.
export const SingleProperty: Story = {
  args: { ...ready, properties: [properties[1]!] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Hotel Elegance')).toBeVisible()
    expect(canvas.queryByLabelText('Portfolio summary')).toBeNull()
    expect(canvas.queryByRole('textbox', { name: 'Search properties' })).toBeNull()
  },
}

// First run — Google import is the only way a property is created (decision 7).
export const Empty: Story = {
  args: { ...ready, properties: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no properties yet/i)).toBeVisible()
    expect(
      canvas.getByRole('link', { name: 'Import your first property from Google' }),
    ).toHaveAttribute('href', '/properties/import-google')
  },
}

// The call to action is long: on the narrowest phone it wraps onto two balanced lines.
export const EmptyAt320: Story = {
  args: { ...ready, properties: [] },
  parameters: { viewport: { defaultViewport: 'mobileNarrow' } },
}

// A manager who cannot import is not sent to a flow that turns them away.
export const EmptyWithoutImportPermission: Story = {
  args: { ...ready, properties: [] },
  decorators: [withRole('PropertyManager')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no properties yet/i)).toBeVisible()
    expect(canvas.getByText(/ask an account admin to import a property/i)).toBeVisible()
    expect(canvas.queryByRole('link', { name: /import/i })).not.toBeInTheDocument()
  },
}

// A removed property leaves the working list but stays reachable for restore.
export const WithRemovedProperty: Story = {
  args: { ...ready, properties: [...properties, removedProperty] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/removed properties \(1\)/i)).toBeVisible()
    expect(canvas.getByRole('link', { name: removedProperty.name })).toHaveAttribute(
      'href',
      `/properties/${removedProperty.id}`,
    )
    // It takes no row in the table.
    expect(bodyRows(canvas)).toHaveLength(6)
  },
}

// Every property removed — the first-run call to action would be wrong here.
export const AllRemoved: Story = {
  args: { ...ready, properties: [removedProperty] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/no active properties/i)).toBeVisible()
    expect(
      canvas.queryByRole('link', { name: /import your first property/i }),
    ).not.toBeInTheDocument()
  },
}
