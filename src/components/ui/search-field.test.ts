import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_LIST_SEARCH_LENGTH } from '#/components/property/list-search-limit'
import { SearchField } from './search-field'

type Props = Parameters<typeof SearchField>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(SearchField, {
      label: 'Search properties',
      value: '',
      onValueChange: () => undefined,
      ...props,
    }),
  )
}

describe('SearchField', () => {
  it('is a search input named by its label, which is also the placeholder', () => {
    const html = render({ label: 'Search portals' })

    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Search portals"')
    expect(html).toContain('placeholder="Search portals"')
  })

  it('takes a placeholder of its own when the example is more useful than the name', () => {
    const html = render({ placeholder: 'Search name or address' })

    expect(html).toContain('placeholder="Search name or address"')
    expect(html).toContain('aria-label="Search properties"')
  })

  it('stops typing where the URL schemas stop, so the 101st character cannot reset it', () => {
    expect(render()).toContain(`maxLength="${MAX_LIST_SEARCH_LENGTH}"`)
  })

  it('takes a shorter limit when the list has one', () => {
    expect(render({ maxLength: 40 })).toContain('maxLength="40"')
  })

  it('is the InputGroup recipe with a Search glyph that is decoration', () => {
    const html = render()

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('lucide-search')
    expect(html).toContain('aria-hidden="true"')
  })

  it('draws no clear button while the field is empty', () => {
    expect(render({ value: '' })).not.toContain('Clear search')
  })

  it('draws a clear button once there is text, named for what it does', () => {
    const html = render({ value: 'cafe' })

    expect(html).toContain('aria-label="Clear search"')
    expect(html).toContain('lucide-x')
  })

  it('makes the clear button a tap target below md, though its glyph is small', () => {
    const html = render({ value: 'cafe' })

    expect(html).toContain('max-md:min-h-(--control-touch)')
    expect(html).toContain('max-md:min-w-(--control-touch)')
  })

  it('names the clear button for the list when the caller says', () => {
    expect(render({ value: 'cafe', clearLabel: 'Clear the search' })).toContain(
      'aria-label="Clear the search"',
    )
  })

  it('can leave the clear button out where the bar has its own way to close the search', () => {
    expect(render({ value: 'cafe', clearable: false })).not.toContain('Clear search')
  })

  it('hides the browser’s own cancel glyph, so the field never shows two', () => {
    // The markup escapes the ampersand of the arbitrary variant.
    expect(render()).toContain('[&amp;::-webkit-search-cancel-button]:appearance-none')
  })

  it('is as wide as its bar on a phone and a toolbar’s width from sm', () => {
    const html = render()

    expect(html).toContain('w-full')
    expect(html).toContain('sm:w-72')
  })

  it('lets a caller give it the whole row', () => {
    const html = render({ className: 'sm:w-full' })

    expect(html).toContain('sm:w-full')
    expect(html).not.toContain('sm:w-72')
  })

  it('is a bare field, a glyph and an input with no frame, for a bar that is the frame', () => {
    const html = render({ variant: 'bare', value: 'cafe' })

    expect(html).not.toContain('data-slot="input-group"')
    expect(html).toContain('data-variant="bare"')
    expect(html).toContain('type="search"')
    expect(html).toContain('lucide-search')
    expect(html).toContain('border-0')
  })

  it('shows the value it was given', () => {
    expect(render({ value: 'rila' })).toContain('value="rila"')
  })
})
