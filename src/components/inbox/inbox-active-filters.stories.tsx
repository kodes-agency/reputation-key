import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, mocked, userEvent, within } from 'storybook/test'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { InboxActiveFilters } from './inbox-active-filters'
import { CLEARED_INBOX_LIST_FILTERS, type InboxListFilterValues } from './inbox-filters'

type HarnessProps = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  searching: boolean
  onClearFilters: () => void
}>

/**
 * Holds the choices so a removed chip really leaves the row, as it does on the
 * page. The button is a stand-in for the list header's Filters trigger: the row
 * hands focus to whatever carries `data-inbox-filter-trigger` when its last
 * chip goes, and the row is not where that trigger lives.
 */
function Harness({
  filters: initialFilters,
  sort: initialSort,
  onFiltersChange,
  onSortChange,
  searching,
  onClearFilters,
}: HarnessProps) {
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState(initialSort)
  return (
    <div className="w-full">
      <button type="button" data-inbox-filter-trigger aria-label="Filters">
        Filters
      </button>
      <InboxActiveFilters
        filters={filters}
        sort={sort}
        onFiltersChange={(patch) => {
          setFilters((current) => ({ ...current, ...patch }))
          onFiltersChange(patch)
        }}
        onSortChange={(next) => {
          setSort(next)
          onSortChange(next)
        }}
        searching={searching}
        onClearFilters={() => {
          // The filters go; the sort stays, as the page's one navigation leaves it.
          setFilters(CLEARED_INBOX_LIST_FILTERS)
          onClearFilters()
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Inbox/Active Filters',
  component: InboxActiveFilters,
  // Fullscreen and full width: the row spans the window as it does on the page,
  // so the metrics gate can read x = 16 off the first chip.
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileStaff' } },
  args: {
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'newest',
    onFiltersChange: fn(),
    onSortChange: fn(),
    searching: false,
    onClearFilters: fn(),
  },
  render: (args) => <Harness {...args} />,
} satisfies Meta<typeof InboxActiveFilters>

export default meta
type Story = StoryObj<typeof meta>

const GROUP = 'Active filters'

export const Nothing: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('group', { name: GROUP }),
    ).not.toBeInTheDocument()
  },
}

// A row that fits: the gate reads "no edge fade" off this one.
export const OneFilter: Story = {
  args: { filters: { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' } },
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    // One chip is its own remedy: no "Clear filters" beside it.
    await expect(
      group.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()
    await expect(
      group.getByRole('button', { name: 'Remove filter: Urgent' }),
    ).toBeVisible()
  },
}

export const RemovingTheOnlyFilter: Story = {
  args: { filters: { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' } },
  play: async ({ canvasElement, args }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await userEvent.click(group.getByRole('button', { name: 'Remove filter: Urgent' }))
    await expect(args.onFiltersChange).toHaveBeenCalledWith({ attention: undefined })
    const patch = mocked(args.onFiltersChange).mock.calls.at(-1)?.[0]
    await expect(patch).toHaveProperty('attention', undefined)
    await expect(
      within(canvasElement).queryByRole('group', { name: GROUP }),
    ).not.toBeInTheDocument()
    // The row that held focus is gone: focus goes to the Filters trigger, where
    // the user can change what is applied, not back to the top of the page.
    await expect(
      within(canvasElement).getByRole('button', { name: 'Filters' }),
    ).toHaveFocus()
  },
}

const SEVERAL: InboxListFilterValues = {
  ...CLEARED_INBOX_LIST_FILTERS,
  sourceType: 'review',
  ratingMin: 4,
  aspect: 'wait_time',
  polarity: 'negative',
}

export const SeveralFilters: Story = {
  args: { filters: SEVERAL },
  play: async ({ canvasElement, args }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    const names = group
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    await expect(names).toEqual([
      'Remove filter: Reviews',
      'Remove filter: 4 stars and up',
      'Remove filter: Complaints',
      'Remove filter: Wait time',
      null,
    ])
    await userEvent.click(
      group.getByRole('button', { name: 'Remove filter: 4 stars and up' }),
    )
    await expect(args.onFiltersChange).toHaveBeenCalledWith({
      ratingMin: undefined,
      ratingMax: undefined,
    })
    // Both bounds are named, so the router drops both.
    const patch = mocked(args.onFiltersChange).mock.calls.at(-1)?.[0]
    await expect(patch).toHaveProperty('ratingMin', undefined)
    await expect(patch).toHaveProperty('ratingMax', undefined)
    await expect(
      group.queryByRole('button', { name: 'Remove filter: 4 stars and up' }),
    ).not.toBeInTheDocument()
    await expect(
      group.getByRole('button', { name: 'Remove filter: Reviews' }),
    ).toBeVisible()
    // Focus went to the chip that took the removed one's place.
    await expect(
      group.getByRole('button', { name: 'Remove filter: Complaints' }),
    ).toHaveFocus()
  },
}

export const RemovingTheLastChipFocusesThePrevious: Story = {
  args: { filters: SEVERAL },
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await userEvent.click(group.getByRole('button', { name: 'Remove filter: Wait time' }))
    await expect(
      group.queryByRole('button', { name: 'Remove filter: Wait time' }),
    ).not.toBeInTheDocument()
    await expect(
      group.getByRole('button', { name: 'Remove filter: Complaints' }),
    ).toHaveFocus()
  },
}

// Every kind of chip at once, so the row overflows a phone and shows its edge fade.
export const AllFilters: Story = {
  args: {
    filters: {
      ...SEVERAL,
      attention: 'urgent',
    },
    sort: 'oldest',
  },
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await expect(group.getAllByRole('button')).toHaveLength(7)
  },
}

export const OldestFirst: Story = {
  args: { sort: 'oldest' },
  play: async ({ canvasElement, args }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await userEvent.click(
      group.getByRole('button', { name: 'Remove filter: Oldest first' }),
    )
    await expect(args.onSortChange).toHaveBeenCalledWith('newest')
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
  },
}

export const ClearFilters: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'feedback', attention: 'high' },
  },
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('group', { name: GROUP })
    await userEvent.click(within(group).getByRole('button', { name: 'Clear filters' }))
    // One navigation, not a change per chip.
    await expect(args.onClearFilters).toHaveBeenCalledTimes(1)
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
    await expect(args.onSortChange).not.toHaveBeenCalled()
    await expect(
      within(canvasElement).queryByRole('group', { name: GROUP }),
    ).not.toBeInTheDocument()
    await expect(
      within(canvasElement).getByRole('button', { name: 'Filters' }),
    ).toHaveFocus()
  },
}

// The order is not a cut of the list: Clear takes the filters away and leaves the
// "Oldest first" chip, which has its own remedy, and focus goes to it.
export const ClearFiltersLeavesTheSort: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'feedback', attention: 'high' },
    sort: 'oldest',
  },
  play: async ({ canvasElement, args }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await userEvent.click(group.getByRole('button', { name: 'Clear filters' }))
    await expect(args.onClearFilters).toHaveBeenCalledTimes(1)
    await expect(args.onSortChange).not.toHaveBeenCalled()
    await expect(
      group.queryByRole('button', { name: 'Remove filter: Feedback' }),
    ).not.toBeInTheDocument()
    await expect(
      group.getByRole('button', { name: 'Remove filter: Oldest first' }),
    ).toHaveFocus()
    // What is left is one chip, its own remedy.
    await expect(
      group.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()
  },
}

// A filter and the order are two chips but one thing to clear: Clear would only
// repeat the chip, so the row offers none.
export const OneFilterAndTheSort: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' },
    sort: 'oldest',
  },
  play: async ({ canvasElement }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await expect(group.getAllByRole('button')).toHaveLength(2)
    await expect(group.queryByRole('button', { name: /^Clear/ })).not.toBeInTheDocument()
  },
}

// A search in force counts as one more thing Clear takes away, so it is offered
// beside a single filter chip and it says so.
export const SearchAndOneFilter: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' },
    searching: true,
  },
  play: async ({ canvasElement, args }) => {
    const group = within(within(canvasElement).getByRole('group', { name: GROUP }))
    await userEvent.click(group.getByRole('button', { name: 'Clear search and filters' }))
    await expect(args.onClearFilters).toHaveBeenCalledTimes(1)
  },
}
