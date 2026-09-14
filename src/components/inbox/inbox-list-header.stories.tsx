import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Meta, StoryObj } from '@storybook/react'
import { InboxListHeader } from './inbox-list-header'
import { CLEARED_INBOX_LIST_FILTERS } from './inbox-filters'

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
