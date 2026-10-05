import { useState, type ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '#/components/ui/button'
import { InboxListHeader } from './inbox-list-header'
import { CLEARED_INBOX_LIST_FILTERS, type InboxListFilterValues } from './inbox-filters'
import { InboxPropertySelect } from './inbox-property-select'
import {
  expectHotelOptions,
  hotelCounts,
  hotels,
} from './inbox-property-select-stories-data'
import { sortScopeProperties } from './inbox-property-scope'
import type { InboxServerFns } from './types'

const TWO_FILTERS: InboxListFilterValues = {
  ...CLEARED_INBOX_LIST_FILTERS,
  attention: 'urgent',
  sourceType: 'review',
}

// Phone stories fill the window like the real panel does; the fixed 400px
// frame is the tablet-and-up list column.
const PHONE_FRAME = 'w-full'
const COLUMN_FRAME = 'w-[400px] border-x'

function HeaderStory({
  filtered = false,
  initialSearch,
  phone = false,
  filters,
  selectionToolbar,
  onFiltersChange = () => undefined,
}: {
  filtered?: boolean
  initialSearch?: string
  phone?: boolean
  filters?: InboxListFilterValues
  selectionToolbar?: ReactNode
  onFiltersChange?: (patch: Partial<InboxListFilterValues>) => void
}) {
  const [search, setSearch] = useState<string | undefined>(initialSearch)
  return (
    <div className={phone ? PHONE_FRAME : COLUMN_FRAME}>
      <InboxListHeader
        queueLabel="Needs reply"
        scopeLabel="Hotel Elegance"
        totalCount={18}
        queueTotal={42}
        searchQ={search}
        filters={
          filters ??
          (filtered
            ? { ...CLEARED_INBOX_LIST_FILTERS, attention: 'urgent' }
            : CLEARED_INBOX_LIST_FILTERS)
        }
        sort="newest"
        onSearchChange={setSearch}
        onFiltersChange={onFiltersChange}
        onSortChange={() => undefined}
        onClearFilters={() => undefined}
        onStartSelection={() => undefined}
        isCompactLayout
        selectionToolbar={selectionToolbar}
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

// At the default 1200px window the header takes its md+ branch: the popover
// and the sort select, exactly as before the phone's sheet existed.
export const Resting: Story = {
  render: () => <HeaderStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Sort reviews' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Filters' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Filters' }))
    // The popover is the dialog "Filters"; the phone's sheet is "Sort and filter".
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByRole('dialog', { name: 'Filters' })).toBeVisible()
    await expect(page.queryByRole('dialog', { name: 'Sort and filter' })).toBeNull()
  },
}
export const Filtered: Story = { render: () => <HeaderStory filtered /> }
export const Searching: Story = {
  render: () => <HeaderStory initialSearch="breakfast" />,
}
export const AllProperties: Story = {
  args: {
    queueLabel: 'Awaiting approval',
    scopeLabel: 'All properties',
    totalCount: 4,
    queueTotal: 42,
    searchQ: undefined,
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'oldest',
    onSearchChange: () => undefined,
    onFiltersChange: () => undefined,
    onSortChange: () => undefined,
    onClearFilters: () => undefined,
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
    queueTotal: 42,
    searchQ: undefined,
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'newest',
    onSearchChange: fn(),
    onFiltersChange: fn(),
    onSortChange: fn(),
    onClearFilters: fn(),
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

const scopeHotels = sortScopeProperties(hotels)

const scopeCounts = (async () =>
  hotelCounts) as unknown as InboxServerFns['getInboxPropertyCounts']

function PropertySelectStory({ phone = false }: { phone?: boolean }) {
  const [activePropertyId, setActivePropertyId] = useState<string | null>(null)
  const scopeLabel =
    scopeHotels.find((hotel) => hotel.id === activePropertyId)?.name ?? 'All properties'
  return (
    <div className={phone ? PHONE_FRAME : 'w-[390px] border-x'}>
      <InboxListHeader
        queueLabel="Needs reply"
        scopeLabel={scopeLabel}
        scopeControl={
          <InboxPropertySelect
            scope={{
              properties: scopeHotels,
              activePropertyId,
              includeAll: true,
              onSelect: setActivePropertyId,
            }}
            scopeLabel={scopeLabel}
            queue="reply"
            placement="header"
            getInboxPropertyCounts={scopeCounts}
          />
        }
        totalCount={23}
        queueTotal={42}
        searchQ={undefined}
        filters={CLEARED_INBOX_LIST_FILTERS}
        sort="newest"
        onSearchChange={() => undefined}
        onFiltersChange={() => undefined}
        onSortChange={() => undefined}
        onClearFilters={() => undefined}
        onStartSelection={() => undefined}
        isCompactLayout
      />
    </div>
  )
}

// Below the desktop floor there is no rail: the scope line opens the same
// property select, with counts for the queue on screen.
export const CompactPropertySelect: Story = {
  render: () => <PropertySelectStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('combobox', { name: 'Property: All properties' }),
    )

    const page = within(canvasElement.ownerDocument.body)
    const list = within(await page.findByRole('listbox'))
    await expect(page.getByText('Needs reply by property')).toBeVisible()
    await expectHotelOptions(list)

    await userEvent.click(list.getByRole('option', { name: /hotel elegance/i }))
    await expect(
      await canvas.findByRole('combobox', { name: 'Property: Hotel Elegance' }),
    ).toBeVisible()
    await waitFor(() => expect(page.queryByRole('listbox')).toBeNull())
  },
}

// ── Phone (below md) ───────────────────────────────────────────────────────
// `viewport` really resizes the runner window, so `useIsMobile()` answers true
// here and the header takes its phone branch (see inbox-mobile-390.stories.tsx).
// No Tailwind is compiled in this runner, so these assert what is on the bar,
// not where it sits; the 16px gutter and the 36px controls belong to the
// Playwright metrics gate.
const phoneParameters = (viewport: 'mobileStaff' | 'mobileNarrow') => ({
  layout: 'fullscreen' as const,
  viewport: { defaultViewport: viewport },
})

async function expectPhoneControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await expect(canvas.getByRole('button', { name: 'Search' })).toBeVisible()
  await expect(canvas.getByRole('button', { name: /^Filters/ })).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Select items' })).toBeVisible()
  // Sort lives in the filter sheet on a phone, not on the bar.
  await expect(canvas.queryByRole('combobox', { name: 'Sort reviews' })).toBeNull()
}

export const PhoneResting: Story = {
  render: () => <HeaderStory phone />,
  parameters: phoneParameters('mobileStaff'),
  play: async ({ canvasElement }) => {
    await expectPhoneControls(canvasElement)
    await expect(
      within(canvasElement).getByRole('button', { name: 'Filters' }),
    ).toBeVisible()
  },
}

export const PhoneNarrow: Story = {
  render: () => <HeaderStory phone />,
  parameters: phoneParameters('mobileNarrow'),
  play: async ({ canvasElement }) => expectPhoneControls(canvasElement),
}

export const PhoneFiltered: Story = {
  render: () => <HeaderStory phone filters={TWO_FILTERS} />,
  parameters: phoneParameters('mobileStaff'),
  play: async ({ canvasElement }) => {
    await expectPhoneControls(canvasElement)
    await expect(
      within(canvasElement).getByRole('button', { name: 'Filters, 2 active' }),
    ).toBeVisible()
  },
}

export const PhoneSearching: Story = {
  render: () => <HeaderStory phone initialSearch="breakfast" />,
  parameters: phoneParameters('mobileStaff'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('searchbox', { name: 'Search reviews' })).toHaveValue(
      'breakfast',
    )
    await expect(canvas.getByRole('button', { name: 'Close search' })).toBeVisible()
    // Search replaces the bar's controls; it does not sit beside them.
    await expect(canvas.queryByRole('button', { name: /^Filters/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Select items' })).toBeNull()
  },
}

export const PhoneSelection: Story = {
  render: () => (
    <HeaderStory
      phone
      selectionToolbar={
        <div className="flex min-w-0 flex-1 items-center justify-between">
          <span className="text-sm font-medium">2 selected</span>
          <Button variant="ghost" size="sm" className="-mr-2 h-9 px-2">
            Cancel
          </Button>
        </div>
      }
    />
  ),
  parameters: phoneParameters('mobileStaff'),
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector<HTMLElement>('[data-inbox-list-header]')
    if (!header) throw new Error('the list header is not on screen')
    // The selection toolbar REPLACES the bar's controls: with it up, Cancel is
    // the only button, so nothing (Search, Filters, Select) rides beside it.
    await expect(
      within(header)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Cancel'])
  },
}

export const PhoneFilterSheet: Story = {
  args: {
    queueLabel: 'Needs reply',
    scopeLabel: 'Hotel Elegance',
    totalCount: 18,
    queueTotal: 42,
    searchQ: undefined,
    filters: CLEARED_INBOX_LIST_FILTERS,
    sort: 'newest',
    onSearchChange: fn(),
    onFiltersChange: fn(),
    onSortChange: fn(),
    onClearFilters: fn(),
    onStartSelection: fn(),
    isCompactLayout: true,
  },
  render: (args) => (
    <div className={PHONE_FRAME}>
      <InboxListHeader {...args} />
    </div>
  ),
  parameters: phoneParameters('mobileStaff'),
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Filters' }))
    const sheet = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Sort and filter',
      }),
    )
    const source = within(sheet.getByRole('radiogroup', { name: 'Source' }))
    await userEvent.click(source.getByRole('radio', { name: 'Reviews' }))
    await expect(args.onFiltersChange).toHaveBeenCalledWith({ sourceType: 'review' })
    await userEvent.click(
      within(sheet.getByRole('radiogroup', { name: 'Sort' })).getByRole('radio', {
        name: 'Oldest',
      }),
    )
    await expect(args.onSortChange).toHaveBeenCalledWith('oldest')
  },
}

// The header is what hands the sheet its loading state and its one-step clear,
// so this drives both through the real header rather than the sheet alone.
export const PhoneFilterSheetWhileLoading: Story = {
  args: {
    ...PhoneFilterSheet.args,
    filters: TWO_FILTERS,
    totalCount: 0,
    queueTotal: 42,
    isLoading: true,
  },
  render: PhoneFilterSheet.render,
  parameters: phoneParameters('mobileStaff'),
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Filters, 2 active' }),
    )
    const sheet = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Sort and filter',
      }),
    )
    await expect(sheet.getByRole('button', { name: 'Show results' })).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Clear filters' }))
    await expect(args.onClearFilters).toHaveBeenCalledTimes(1)
    await expect(args.onFiltersChange).not.toHaveBeenCalled()
    await expect(args.onSortChange).not.toHaveBeenCalled()
  },
}

// The scope select is the header's leading control below the desktop floor:
// it has to sit beside Search, Filters and Select without crowding them.
export const PhoneAllProperties: Story = {
  render: () => <PropertySelectStory phone />,
  parameters: phoneParameters('mobileStaff'),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('combobox', { name: 'Property: All properties' }),
    ).toBeVisible()
    await expectPhoneControls(canvasElement)
  },
}

export const PhoneAllPropertiesNarrow: Story = {
  render: () => <PropertySelectStory phone />,
  parameters: phoneParameters('mobileNarrow'),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('combobox', { name: 'Property: All properties' }),
    ).toBeVisible()
    await expectPhoneControls(canvasElement)
  },
}
