import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Meta, StoryObj } from '@storybook/react'
import { InboxListHeader } from './inbox-list-header'
import { CLEARED_INBOX_LIST_FILTERS } from './inbox-filters'
import { InboxScopeMenu } from './inbox-scope-menu'

function HeaderStory({
  filtered = false,
  initialSearch,
}: {
  filtered?: boolean
  initialSearch?: string
}) {
  const [search, setSearch] = useState<string | undefined>(initialSearch)
  return (
    <div className="w-[400px] border-x">
      <InboxListHeader
        queueLabel="Needs reply"
        scopeLabel="Hotel Elegance"
        totalCount={18}
        searchQ={search}
        filters={
          filtered
            ? { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' }
            : CLEARED_INBOX_LIST_FILTERS
        }
        sort="newest"
        onSearchChange={setSearch}
        onFiltersChange={() => undefined}
        onSortChange={() => undefined}
        onStartSelection={() => undefined}
        isCompactLayout
      />
    </div>
  )
}

const meta: Meta<typeof InboxListHeader> = {
  title: 'Inbox/List Header',
  component: InboxListHeader,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxListHeader>

export const Resting: Story = { render: () => <HeaderStory /> }
export const Filtered: Story = { render: () => <HeaderStory filtered /> }
export const Searching: Story = {
  render: () => <HeaderStory initialSearch="breakfast" />,
}
export const AllProperties: Story = {
  args: {
    queueLabel: 'Awaiting approval',
    scopeLabel: 'All properties',
    totalCount: 4,
    searchQ: undefined,
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'oldest',
    onSearchChange: () => undefined,
    onFiltersChange: () => undefined,
    onSortChange: () => undefined,
  },
  render: (args) => (
    <div className="w-[400px] border-x">
      <InboxListHeader {...args} />
    </div>
  ),
}

export const CompactSelectionControl: Story = {
  args: {
    queueLabel: 'Needs reply',
    scopeLabel: 'Hotel Elegance',
    totalCount: 18,
    searchQ: undefined,
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'newest',
    onSearchChange: fn(),
    onFiltersChange: fn(),
    onSortChange: fn(),
    onStartSelection: fn(),
    isCompactLayout: true,
  },
  render: (args) => (
    <div className="w-[820px] border-x">
      <InboxListHeader {...args} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const select = within(canvasElement).getByRole('button', {
      name: 'Select items',
    })
    await expect(select).toBeVisible()
    await userEvent.click(select)
    await expect(args.onStartSelection).toHaveBeenCalledOnce()
  },
}

const scopeHotels = [
  { id: '10000000-0000-4000-8000-000000000003', name: 'Black Sea Residence' },
  { id: '10000000-0000-4000-8000-000000000001', name: 'Hotel Elegance' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Rila Grand Hotel' },
]

function ScopeMenuStory() {
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null)
  const scopeLabel =
    scopeHotels.find((hotel) => hotel.id === activePropertyId)?.name ?? 'All properties'
  return (
    <div className="w-[390px] border-x">
      <InboxListHeader
        queueLabel="Needs reply"
        scopeLabel={scopeLabel}
        scopeControl={
          <InboxScopeMenu
            queueLabel="Needs reply"
            scopeLabel={scopeLabel}
            scope={{
              properties: scopeHotels,
              activePropertyId,
              includeAll: true,
              counts: {
                queue: 'reply',
                total: 23,
                byProperty: {
                  [scopeHotels[0].id]: 3,
                  [scopeHotels[1].id]: 12,
                  [scopeHotels[2].id]: 8,
                },
              },
              onSelect: setActivePropertyId,
            }}
          />
        }
        totalCount={23}
        searchQ={undefined}
        filters={CLEARED_INBOX_LIST_FILTERS}
        sort="newest"
        onSearchChange={() => undefined}
        onFiltersChange={() => undefined}
        onSortChange={() => undefined}
        onStartSelection={() => undefined}
        isCompactLayout
      />
    </div>
  )
}

// Below the desktop floor there is no rail: the scope line is the property
// control, listing the rail's properties with counts for the queue on screen.
export const CompactScopeMenu: Story = {
  render: () => <ScopeMenuStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /all properties/i }))

    const page = within(canvasElement.ownerDocument.body)
    const menu = await page.findByRole('menu')
    await expect(within(menu).getByText('Needs reply by property')).toBeVisible()
    const options = within(menu).getAllByRole('menuitemradio')
    await expect(options.map((option) => option.textContent)).toEqual([
      'All properties23',
      'Black Sea Residence3',
      'Hotel Elegance12',
      'Rila Grand Hotel8',
    ])
    await expect(options[0]).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(options[2])
    await expect(
      await canvas.findByRole('button', { name: /hotel elegance/i }),
    ).toBeVisible()
  },
}
