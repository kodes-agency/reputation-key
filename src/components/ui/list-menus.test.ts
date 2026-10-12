import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListTree } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { ListChoiceMenu, ListFilterMenu, listMenuValueText } from './list-choice-menu'
import { ListSortMenu } from './list-sort-menu'

const SHOW = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'setup', label: 'Setup to finish' },
] as const

describe('listMenuValueText', () => {
  it('names the choice in force', () => {
    expect(listMenuValueText(SHOW, 'setup', 'All')).toBe('Setup to finish')
  })

  it('says the fallback when nothing is chosen', () => {
    expect(listMenuValueText(SHOW, null, 'All')).toBe('All')
  })

  it('says the fallback for a value the options no longer offer', () => {
    expect(listMenuValueText(SHOW, 'google', 'All')).toBe('All')
  })
})

describe('ListFilterMenu', () => {
  const render = (value: 'attention' | 'setup' | null) =>
    renderToStaticMarkup(
      createElement(ListFilterMenu<'attention' | 'setup'>, {
        label: 'Show',
        value,
        options: SHOW,
        allLabel: 'All properties',
        onChange: () => undefined,
      }),
    )

  it('is an outline button that reads "Label: value", with the filter glyph', () => {
    const html = render('attention')

    expect(html).toContain('Show: Needs attention')
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('lucide-list-filter')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it('reads "All" when nothing narrows the list', () => {
    expect(render(null)).toContain('Show: All')
  })
})

describe('ListChoiceMenu', () => {
  it('is the same button with a glyph of its own, for a view choice like Group by', () => {
    const html = renderToStaticMarkup(
      createElement(ListChoiceMenu<'group' | 'none'>, {
        label: 'Group by',
        icon: ListTree,
        value: 'none',
        options: [
          { value: 'group', label: 'Portal group' },
          { value: 'none', label: 'None' },
        ],
        onChange: () => undefined,
      }),
    )

    expect(html).toContain('Group by: None')
    expect(html).toContain('lucide-list-tree')
  })
})

describe('ListSortMenu', () => {
  const render = (sort: 'name' | 'rating') =>
    renderToStaticMarkup(
      createElement(ListSortMenu<'name' | 'rating'>, {
        sort,
        dir: 'asc',
        options: ['name', 'rating'],
        labels: { name: 'Name', rating: 'Rating' },
        directionLabels: {
          name: { asc: 'A to Z', desc: 'Z to A' },
          rating: { desc: 'Highest first', asc: 'Lowest first' },
        },
        defaultDirection: (value) => (value === 'name' ? 'asc' : 'desc'),
        onChange: () => undefined,
      }),
    )

  it('is an outline button that reads "Sort: value", with the sort glyph', () => {
    const html = render('rating')

    expect(html).toContain('Sort: Rating')
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('lucide-arrow-down-up')
  })
})
