// The parts of a list's toolbar, composed the way the Properties list and the
// Portals overview compose them: search, a filter menu, a sort menu, the result
// count and the one Clear control. The harness filters a small list with the
// app's own matcher (`searchMatcher`), so what the plays prove is the behaviour a
// list gets for free: the count says "N of M" only while the list is narrowed,
// Clear takes the search and the filters away and leaves the sort, and its words
// follow whether a search is in force. The Storybook Vitest project compiles no
// Tailwind, so nothing here claims a pixel. Dark is the default theme; the light
// variants render the same toolbar on the light surface (axe runs on both).
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { searchMatcher } from '#/components/property/property-search'
import { ClearFiltersButton } from './clear-filters-button'
import { ListFilterMenu } from './list-choice-menu'
import { ListSortMenu } from './list-sort-menu'
import type { SortDirection } from './list-sort'
import { ListToolbar, ListToolbarStatus } from './list-toolbar'
import { ResultCount } from './result-count'
import { SearchField } from './search-field'

type Show = 'attention' | 'google'
type Sort = 'name' | 'rating'

const ROWS = [
  { name: 'Café Plaza', rating: 4.1, show: 'attention' },
  { name: 'Rila Grand Hotel', rating: 4.8, show: null },
  { name: 'Harborline Suites', rating: 3.9, show: 'google' },
  { name: 'Stara Zagora Inn', rating: 4.4, show: null },
] as const

const SHOW_OPTIONS = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'google', label: 'Google not linked' },
] as const

const SORT_LABELS = { name: 'Name', rating: 'Rating' } as const
const DIRECTION_LABELS = {
  name: { asc: 'A to Z', desc: 'Z to A' },
  rating: { desc: 'Highest first', asc: 'Lowest first' },
} as const

function Harness({
  initialQuery = '',
  initialShow = null,
  filters = true,
}: Readonly<{
  initialQuery?: string
  initialShow?: Show | null
  /** The list has a filter menu. A list with only a search (All properties) has none. */
  filters?: boolean
}>) {
  const [query, setQuery] = useState(initialQuery)
  const [show, setShow] = useState<Show | null>(initialShow)
  const [sort, setSort] = useState<Sort>('name')
  const [dir, setDir] = useState<SortDirection>('asc')
  const matches = searchMatcher(query)
  const sign = dir === 'asc' ? 1 : -1
  // `filter` makes the copy that `sort` then orders in place.
  const ordered = ROWS.filter(
    (row) => matches(row.name) && (show === null || row.show === show),
  ).sort(
    (a, b) =>
      sign * (sort === 'name' ? a.name.localeCompare(b.name) : a.rating - b.rating),
  )
  const searching = query.trim() !== ''
  const narrowed = searching || show !== null
  return (
    <div className="flex flex-col gap-4">
      <ListToolbar>
        <SearchField
          label="Search properties"
          placeholder="Search name or address"
          value={query}
          onValueChange={setQuery}
        />
        {filters ? (
          <ListFilterMenu<Show>
            label="Show"
            value={show}
            allLabel="All properties"
            options={SHOW_OPTIONS}
            onChange={setShow}
          />
        ) : null}
        <ListSortMenu<Sort>
          sort={sort}
          dir={dir}
          options={['name', 'rating']}
          labels={SORT_LABELS}
          directionLabels={DIRECTION_LABELS}
          defaultDirection={(value) => (value === 'name' ? 'asc' : 'desc')}
          onChange={(next) => {
            setSort(next.sort)
            setDir(next.dir ?? (next.sort === 'name' ? 'asc' : 'desc'))
          }}
        />
        <ListToolbarStatus>
          <ResultCount shown={ordered.length} total={ROWS.length} active={narrowed} />
          {narrowed ? (
            <ClearFiltersButton
              searching={searching}
              filters={filters}
              onClear={() => {
                setQuery('')
                setShow(null)
              }}
            />
          ) : null}
        </ListToolbarStatus>
      </ListToolbar>
      <ul aria-label="Properties">
        {ordered.map((row) => (
          <li key={row.name}>{row.name}</li>
        ))}
      </ul>
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Patterns/List toolbar',
  component: Harness,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

const names = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByRole('list', { name: 'Properties' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

/** Nothing narrows the list: the count says nothing and there is nothing to clear. */
export const Resting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('searchbox', { name: 'Search properties' })).toHaveValue('')
    expect(canvas.getByRole('button', { name: 'Show: All' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Sort: Name' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: /^Clear/ })).toBeNull()
    // The live region is there, empty, so the first count is announced.
    expect(canvasElement.querySelector('[data-slot="result-count"]')).toHaveTextContent(
      '',
    )
    expect(names(canvas)).toHaveLength(4)
  },
}

/** Typing narrows the list; the count and Clear arrive together and Clear names the search. */
export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search properties' }),
      'rila',
    )
    expect(canvas.getByText('1 of 4')).toBeVisible()
    expect(names(canvas)).toEqual(['Rila Grand Hotel'])
    expect(canvas.getByRole('button', { name: 'Clear search and filters' })).toBeVisible()
  },
}

/** A list with a search and no filter does not promise to clear one: Clear reads "Clear search". */
export const SearchOnly: Story = {
  args: { filters: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: /^Show:/ })).toBeNull()
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search properties' }),
      'rila',
    )
    expect(canvas.getByText('1 of 4')).toBeVisible()
    expect(canvas.queryByRole('button', { name: /filters/i })).toBeNull()
    // The toolbar's Clear is the last of the controls named so, after the field's own X.
    const clear = canvas.getAllByRole('button', { name: 'Clear search' }).at(-1)
    if (clear === undefined) throw new Error('expected a Clear search button')
    await userEvent.click(clear)
    expect(names(canvas)).toHaveLength(4)
    expect(canvas.queryByRole('button', { name: /^Clear/ })).toBeNull()
  },
}

/** Case and accents never decide a match: "cafe" finds "Café Plaza". */
export const FindsThroughAccents: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('searchbox', { name: 'Search properties' }),
      'CAFE',
    )
    expect(names(canvas)).toEqual(['Café Plaza'])
  },
}

/** The field's own X clears the text and keeps the focus in the field. */
export const ClearButtonInTheField: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('searchbox', { name: 'Search properties' })
    expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull()
    await userEvent.type(box, 'rila')
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(names(canvas)).toHaveLength(4)
  },
}

/** The field stops where the URL schemas stop, instead of resetting on the 101st character. */
export const StopsAtItsLimit: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('searchbox', {
      name: 'Search properties',
    })
    await userEvent.click(box)
    await userEvent.paste('a'.repeat(120))
    expect(box).toHaveValue('a'.repeat(100))
  },
}

/** A filter alone: Clear says "filters", and the count reads "N of M". */
export const Filtering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show: All' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', {
        name: 'Needs attention',
      }),
    )
    expect(canvas.getByRole('button', { name: 'Show: Needs attention' })).toBeVisible()
    expect(canvas.getByText('1 of 4')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }))
    expect(canvas.getByRole('button', { name: 'Show: All' })).toBeVisible()
    expect(names(canvas)).toHaveLength(4)
  },
}

/** The menu's first entry takes the filter off without Clear. */
export const FilterMenuHasAnAllEntry: Story = {
  args: { initialShow: 'google' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show: Google not linked' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', { name: 'All properties' }),
    )
    expect(canvas.getByRole('button', { name: 'Show: All' })).toBeVisible()
  },
}

/** A sort lists its natural direction first; a new sort starts at its own. */
export const SortMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Sort: Name' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', { name: 'Rating' }),
    )
    expect(canvas.getByRole('button', { name: 'Sort: Rating' })).toBeVisible()
    expect(names(canvas)[0]).toBe('Rila Grand Hotel')
    await userEvent.click(canvas.getByRole('button', { name: 'Sort: Rating' }))
    const menu = within(await within(document.body).findByRole('menu'))
    const directions = menu
      .getAllByRole('menuitemradio')
      .map((item) => item.textContent)
      .slice(-2)
    expect(directions).toEqual(['Highest first', 'Lowest first'])
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Lowest first' }))
    await waitFor(() => expect(names(canvas)[0]).toBe('Harborline Suites'))
  },
}

/** Clear is the search and the filters; the sort is an order, not a cut, and stays. */
export const ClearLeavesTheSort: Story = {
  args: { initialQuery: 'a' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Sort: Name' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', { name: 'Rating' }),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Clear search and filters' }),
    )
    expect(canvas.getByRole('button', { name: 'Sort: Rating' })).toBeVisible()
    expect(canvas.queryByRole('button', { name: /^Clear/ })).toBeNull()
  },
}

export const RestingLight: Story = { ...Resting, parameters: { theme: 'light' } }

export const NarrowedLight: Story = {
  args: { initialQuery: 'rila', initialShow: null },
  parameters: { theme: 'light' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText('1 of 4')).toBeVisible()
  },
}
