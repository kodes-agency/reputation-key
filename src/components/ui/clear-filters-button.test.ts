import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClearFiltersButton, clearFiltersLabel } from './clear-filters-button'

describe('clearFiltersLabel', () => {
  it('is "Clear filters" when only filters narrow the list', () => {
    expect(clearFiltersLabel(false)).toBe('Clear filters')
  })

  it('names the search too while one is active, because Clear takes it away', () => {
    expect(clearFiltersLabel(true)).toBe('Clear search and filters')
  })

  it('is "Clear search" for a list that has no filter to clear', () => {
    expect(clearFiltersLabel(true, false)).toBe('Clear search')
    expect(clearFiltersLabel(false, false)).toBe('Clear search')
  })
})

describe('ClearFiltersButton', () => {
  const render = (props: Parameters<typeof ClearFiltersButton>[0]) =>
    renderToStaticMarkup(createElement(ClearFiltersButton, props))

  it('is a ghost button that says what it clears', () => {
    const html = render({ searching: false, onClear: () => undefined })

    expect(html).toContain('>Clear filters<')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('type="button"')
  })

  it('says "Clear search and filters" while a search is active', () => {
    expect(render({ searching: true, onClear: () => undefined })).toContain(
      '>Clear search and filters<',
    )
  })

  it('says only "Clear search" on a list with a search and no filters', () => {
    const html = render({ searching: true, filters: false, onClear: () => undefined })

    expect(html).toContain('>Clear search<')
    expect(html).not.toContain('filters')
  })

  it('is the outline button of an empty result', () => {
    expect(
      render({ searching: true, variant: 'outline', onClear: () => undefined }),
    ).toContain('data-variant="outline"')
  })

  it('can be disabled when there is nothing to clear', () => {
    expect(
      render({ searching: false, disabled: true, onClear: () => undefined }),
    ).toContain('disabled=""')
  })
})
