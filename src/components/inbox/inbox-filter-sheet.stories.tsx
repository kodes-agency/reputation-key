import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { InboxFilterSheet } from './inbox-filter-sheet'
import { CLEARED_INBOX_LIST_FILTERS, type InboxListFilterValues } from './inbox-filters'

type HarnessProps = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  totalCount: number
  isLoading: boolean
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  onClearAll: () => void
}>

/** Holds the choices so a click shows up as a checked chip, as it does on the page. */
function Harness({
  filters: initialFilters,
  sort: initialSort,
  totalCount,
  isLoading,
  onFiltersChange,
  onSortChange,
  onClearAll,
}: HarnessProps) {
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState(initialSort)
  return (
    <InboxFilterSheet
      filters={filters}
      sort={sort}
      totalCount={totalCount}
      isLoading={isLoading}
      onFiltersChange={(patch) => {
        setFilters((current) => ({ ...current, ...patch }))
        onFiltersChange(patch)
      }}
      onSortChange={(next) => {
        setSort(next)
        onSortChange(next)
      }}
      onClearAll={() => {
        setFilters(CLEARED_INBOX_LIST_FILTERS)
        setSort('newest')
        onClearAll()
      }}
    />
  )
}

const meta = {
  title: 'Inbox/Filter Sheet',
  component: InboxFilterSheet,
  parameters: { layout: 'centered', viewport: { defaultViewport: 'mobileStaff' } },
  args: {
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'newest',
    totalCount: 18,
    isLoading: false,
    onFiltersChange: fn(),
    onSortChange: fn(),
    onClearAll: fn(),
  },
  render: (args) => <Harness {...args} />,
} satisfies Meta<typeof InboxFilterSheet>

export default meta
type Story = StoryObj<typeof meta>

/** The sheet is a Radix portal: it lives on `document.body`, not in the story root. */
async function openSheet(canvasElement: HTMLElement, triggerName: string | RegExp) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: triggerName }))
  const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
    name: 'Sort and filter',
  })
  return within(dialog)
}

export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Filters' })).toBeVisible()
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole('dialog'),
    ).not.toBeInTheDocument()
  },
}

export const ActiveCount: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'review', attention: 'urgent' },
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'Filters, 2 active',
    })
    // The badge is decoration: the accessible name already carries the count.
    await expect(trigger).toHaveTextContent('2')
  },
}

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    for (const name of ['Sort', 'Source', 'Rating', 'Priority', 'Polarity', 'Aspect']) {
      await expect(sheet.getByRole('radiogroup', { name })).toBeVisible()
    }
    await expect(sheet.getByRole('button', { name: 'Show 18 results' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    // Newest is the resting sort, so it is the one checked choice in its group.
    await expect(sheet.getByRole('radio', { name: 'Newest' })).toBeChecked()
  },
}

export const ChooseSource: Story = {
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    const source = within(sheet.getByRole('radiogroup', { name: 'Source' }))
    await userEvent.click(source.getByRole('radio', { name: 'Reviews' }))
    await expect(args.onFiltersChange).toHaveBeenCalledWith({ sourceType: 'review' })
    await expect(source.getByRole('radio', { name: 'Reviews' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(source.getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  },
}

export const ChooseRating: Story = {
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    const rating = within(sheet.getByRole('radiogroup', { name: 'Rating' }))
    await userEvent.click(rating.getByRole('radio', { name: '3 stars and below' }))
    await expect(args.onFiltersChange).toHaveBeenCalledWith({
      ratingMin: undefined,
      ratingMax: 3,
    })
    // toHaveBeenCalledWith treats a missing key like an undefined one, but the
    // router only drops the old bound when the patch names it: a patch without
    // `ratingMin` would leave a previous "5 stars" half applied.
    const patch = mocked(args.onFiltersChange).mock.calls.at(-1)?.[0]
    await expect(patch).toHaveProperty('ratingMin', undefined)
    await expect(patch).toHaveProperty('ratingMax', 3)
  },
}

export const ArrowKeysRoveTheGroup: Story = {
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    const source = within(sheet.getByRole('radiogroup', { name: 'Source' }))
    const all = source.getByRole('radio', { name: 'All' })
    const reviews = source.getByRole('radio', { name: 'Reviews' })
    const feedback = source.getByRole('radio', { name: 'Feedback' })
    // One tab stop per group: the checked choice, and no other.
    await expect(all).toHaveAttribute('tabindex', '0')
    await expect(reviews).toHaveAttribute('tabindex', '-1')

    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(reviews).toHaveFocus()
    await expect(reviews).toHaveAttribute('aria-checked', 'true')
    await expect(reviews).toHaveAttribute('tabindex', '0')
    await expect(args.onFiltersChange).toHaveBeenLastCalledWith({ sourceType: 'review' })

    await userEvent.keyboard('{ArrowDown}')
    await expect(feedback).toHaveFocus()
    await expect(args.onFiltersChange).toHaveBeenLastCalledWith({
      sourceType: 'feedback',
    })

    // Past the last choice it wraps to the first, and back again the other way.
    await userEvent.keyboard('{ArrowRight}')
    await expect(all).toHaveFocus()
    await expect(all).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    await expect(feedback).toHaveFocus()

    await userEvent.keyboard('{Home}')
    await expect(all).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(feedback).toHaveFocus()
  },
}

export const ModifierArrowsAreLeftToTheBrowser: Story = {
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    const source = within(sheet.getByRole('radiogroup', { name: 'Source' }))
    const all = source.getByRole('radio', { name: 'All' })
    all.focus()
    // Alt+Right is history navigation, Ctrl/Cmd+arrows are browser and OS
    // shortcuts: none of them may move or change the choice.
    for (const modifier of ['Alt', 'Control', 'Meta']) {
      await userEvent.keyboard(`{${modifier}>}{ArrowRight}{/${modifier}}`)
    }
    await expect(all).toHaveFocus()
    await expect(all).toBeChecked()
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
  },
}

export const ChooseOldest: Story = {
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    const sort = within(sheet.getByRole('radiogroup', { name: 'Sort' }))
    await userEvent.click(sort.getByRole('radio', { name: 'Oldest' }))
    await expect(args.onSortChange).toHaveBeenCalledWith('oldest')
    await expect(sort.getByRole('radio', { name: 'Oldest' })).toBeChecked()
    // A non-default sort is something there is to clear.
    await expect(sheet.getByRole('button', { name: 'Clear all' })).toBeEnabled()
  },
}

export const ClearAll: Story = {
  args: {
    filters: { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'review', ratingMax: 3 },
    sort: 'oldest',
  },
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters, 2 active')
    await userEvent.click(sheet.getByRole('button', { name: 'Clear all' }))
    // One navigation, not a filters change followed by a sort change: two
    // history entries would leave the first Back press on a half-cleared list.
    await expect(args.onClearAll).toHaveBeenCalledTimes(1)
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
    await expect(args.onSortChange).not.toHaveBeenCalled()
    await expect(
      within(sheet.getByRole('radiogroup', { name: 'Source' })).getByRole('radio', {
        name: 'All',
      }),
    ).toBeChecked()
    await expect(
      within(sheet.getByRole('radiogroup', { name: 'Sort' })).getByRole('radio', {
        name: 'Newest',
      }),
    ).toBeChecked()
    const clear = sheet.getByRole('button', { name: 'Clear all' })
    await expect(clear).toBeDisabled()
    // Focus left the button that just went disabled for the one that closes
    // the sheet, so a keyboard user is not dropped back to the page behind it.
    await expect(sheet.getByRole('button', { name: 'Show 18 results' })).toHaveFocus()
  },
}

export const CheckedChipDoesNothing: Story = {
  args: { filters: { ...CLEARED_INBOX_LIST_FILTERS, sourceType: 'review' } },
  play: async ({ canvasElement, args }) => {
    const sheet = await openSheet(canvasElement, 'Filters, 1 active')
    const source = within(sheet.getByRole('radiogroup', { name: 'Source' }))
    const reviews = source.getByRole('radio', { name: 'Reviews' })
    await userEvent.click(reviews)
    reviews.focus()
    await userEvent.keyboard(' ')
    await userEvent.click(
      within(sheet.getByRole('radiogroup', { name: 'Sort' })).getByRole('radio', {
        name: 'Newest',
      }),
    )
    // Choosing what is already chosen is not a change: no history entry, no refetch.
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
    await expect(args.onSortChange).not.toHaveBeenCalled()
    await expect(reviews).toBeChecked()
  },
}

export const ResultsButtonClosesTheSheet: Story = {
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    await userEvent.click(sheet.getByRole('button', { name: 'Show 18 results' }))
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole('dialog'),
      ).not.toBeInTheDocument(),
    )
  },
}

export const OneResult: Story = {
  args: { totalCount: 1 },
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    await expect(sheet.getByRole('button', { name: 'Show 1 result' })).toBeVisible()
  },
}

// The count is stale (or zero) until the list arrives, so the button promises
// nothing it cannot back: "No results" would be wrong for a list still loading.
export const Loading: Story = {
  args: { totalCount: 0, isLoading: true },
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    await expect(sheet.getByRole('button', { name: 'Show results' })).toBeVisible()
    await expect(sheet.queryByRole('button', { name: 'No results' })).toBeNull()
  },
}

export const NoResults: Story = {
  args: { totalCount: 0 },
  play: async ({ canvasElement }) => {
    const sheet = await openSheet(canvasElement, 'Filters')
    await expect(sheet.getByRole('button', { name: 'No results' })).toBeVisible()
  },
}
