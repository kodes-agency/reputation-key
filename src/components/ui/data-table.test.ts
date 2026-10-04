// DataTable (UI consistency scan: COLL-03).
//
// `ui/table` was used raw in thirteen files with seven frames, four header
// recipes and four ways to degrade on a phone. The Properties list table is the
// reference: a bordered `bg-card` frame that is a `@container`, a quiet header row,
// and rows that stack as small grids below a container width. The shell is that
// recipe once; a table that must scroll sideways (a matrix) keeps the frame and the
// header and drops the stacking.
import { createElement, type FunctionComponent, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableSortHead,
} from './data-table'

type TableProps = Parameters<typeof DataTable>[0]

/** createElement without the props' `children` requirement: the parts take theirs as arguments. */
const h = (type: unknown, props: object | null, ...children: ReactNode[]) =>
  createElement(type as FunctionComponent, props, ...children)

function table(props: Partial<TableProps> = {}, children: ReactNode[] = []): string {
  return renderToStaticMarkup(h(DataTable, { label: 'Members', ...props }, ...children))
}

describe('DataTable frame', () => {
  it('is a labelled table in a bordered card that lays itself out by its own width', () => {
    const html = table()

    expect(html).toContain('aria-label="Members"')
    expect(html).toMatch(
      /^<div class="@container"><div class="overflow-hidden rounded-lg border bg-card">/u,
    )
  })

  it('is a block, and a table only from the container width it was given', () => {
    expect(table()).toContain('block @4xl:table')
    expect(table({ from: '3xl' })).toContain('block @3xl:table')
    expect(table({ layout: 'cards', from: '2xl' })).toContain('block @2xl:table')
  })

  it('does not frame the cards of a list that stacks as cards until it is a table', () => {
    const html = table({ layout: 'cards' })

    // The frame is inside the container that measures it: a container cannot be
    // queried by its own classes.
    expect(html).toMatch(
      /^<div class="@container"><div class="@4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card">/u,
    )
  })

  it('keeps the frame and the table of a matrix that scrolls sideways, with no stacking', () => {
    const html = table({ layout: 'scroll' })

    expect(html).toMatch(/<div class="overflow-hidden rounded-lg border bg-card">/u)
    expect(html).not.toContain('block @4xl:table')
    expect(html).not.toContain('@4xl:table')
  })

  it('says it is busy and dims while a new window of data loads', () => {
    const html = table({ busy: true })

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('opacity-60')
    expect(table()).not.toContain('aria-busy')
  })
})

function inside(part: ReactNode, props: Partial<TableProps> = {}): string {
  return table(props, [part])
}

describe('DataTable parts', () => {
  it('hides the header row below the container width', () => {
    const html = inside(h(DataTableHeader, null))

    expect(html).toContain('hidden @4xl:table-header-group')
  })

  it('keeps the header of a scrolling table', () => {
    const html = inside(h(DataTableHeader, null), { layout: 'scroll' })

    expect(html).toContain('<thead')
    expect(html).not.toContain('table-header-group')
  })

  it('draws a header cell as the one quiet recipe', () => {
    const html = inside(h(DataTableHeader, null, h(DataTableHead, null, 'Name')))

    expect(html).toContain('scope="col"')
    expect(html).toContain('h-10 px-4 text-xs text-muted-foreground')
    expect(html).toContain('>Name</th>')
  })

  it('right-aligns a numeric header cell', () => {
    const html = inside(
      h(DataTableHeader, null, h(DataTableHead, { align: 'end' }, 'Rating')),
    )

    expect(html).toContain('text-right')
  })

  it('names the actions column for a screen reader and prints no word for it', () => {
    const html = inside(h(DataTableHeader, null, h(DataTableHead, { actions: true })))

    expect(html).toContain('<span class="sr-only">Actions</span>')
  })

  it.each([
    ['asc', 'ascending'],
    ['desc', 'descending'],
  ] as const)('marks a header sorted %s with aria-sort', (direction, ariaSort) => {
    const html = inside(
      h(
        DataTableHeader,
        null,
        h(DataTableSortHead, { direction, onSort: () => undefined }, 'Rating'),
      ),
    )

    expect(html).toContain(`aria-sort="${ariaSort}"`)
    expect(html).toContain('>Rating<')
  })

  it('leaves an unsorted header without aria-sort, as a button that sorts', () => {
    const html = inside(
      h(
        DataTableHeader,
        null,
        h(DataTableSortHead, { direction: null, onSort: () => undefined }, 'Name'),
      ),
    )

    expect(html).not.toContain('aria-sort')
    expect(html).toContain('<button type="button"')
  })

  it('stacks a row as a small grid below the container width, and a table row from it', () => {
    const html = inside(
      h(DataTableBody, null, h(DataTableRow, { tracks: 2 }, h(DataTableCell, null, 'x'))),
    )

    expect(html).toContain('block @4xl:table-row-group')
    expect(html).toContain('grid')
    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(html).toContain('@4xl:table-row @4xl:p-0')
    expect(html).toContain('@4xl:table-cell @4xl:px-4 @4xl:py-3')
  })

  it('has two or three tracks to stack into: a flexible first, then the rest as wide as they are', () => {
    const row = (tracks: 2 | 3) =>
      inside(h(DataTableBody, null, h(DataTableRow, { tracks })))

    expect(row(2)).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(row(3)).toContain('grid-cols-[minmax(0,1fr)_auto_auto]')
  })

  it('keeps the last card its border, and drops the last row divider only as a table', () => {
    const html = inside(h(DataTableBody, null, h(DataTableRow, null)), {
      layout: 'cards',
    })

    // (the markup escapes the ampersand of the arbitrary variant)
    expect(html).toContain('[&amp;_tr:last-child]:border ')
    expect(html).toContain('@4xl:[&amp;_tr:last-child]:border-0')
    expect(html).not.toMatch(/(^|\s)\[&amp;_tr:last-child\]:border-0/u)
  })

  it('leaves the cells of a list of cards to the caller, who sets each for its density', () => {
    const html = inside(
      h(
        DataTableBody,
        null,
        h(DataTableRow, null, h(DataTableCell, { className: 'px-3' }, 'x')),
      ),
      { layout: 'cards' },
    )

    expect(html).toContain('px-3')
    expect(html).not.toContain('@4xl:table-cell')
  })

  it('stacks a row as a card of its own when the list asks for cards', () => {
    const html = inside(h(DataTableBody, null, h(DataTableRow, null)), {
      layout: 'cards',
    })

    expect(html).toContain('rounded-lg border bg-card')
    expect(html).toContain('@4xl:rounded-none @4xl:border-0 @4xl:border-b')
    expect(html).toContain('space-y-3')
  })

  it('is a plain row of plain cells in a table that scrolls', () => {
    const html = inside(
      h(DataTableBody, null, h(DataTableRow, null, h(DataTableCell, null, 'x'))),
      { layout: 'scroll' },
    )

    expect(html).not.toContain('grid')
    expect(html).not.toContain('block')
    expect(html).toContain('px-4 py-3')
  })

  it('takes the container width from the table, one place, for every part', () => {
    const html = inside(
      h(DataTableBody, null, h(DataTableRow, { tracks: 2 }, h(DataTableCell, null, 'x'))),
      { from: '3xl' },
    )

    expect(html).toContain('@3xl:table-row-group')
    expect(html).toContain('@3xl:table-row @3xl:p-0')
    expect(html).toContain('@3xl:table-cell @3xl:px-4 @3xl:py-3')
    expect(html).not.toContain('@4xl')
  })
})
