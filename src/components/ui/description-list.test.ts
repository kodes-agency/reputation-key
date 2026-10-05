// DescriptionList (UI consistency scan: COLL-23).
//
// Read-only label/value rows were hand-built as a <dl> in six grids (an 8rem, a 10rem
// and a 7rem label column, a stacked one, bordered cells), with the term muted in
// some and plain in others. `ui/fact` is a toolbar fact, not this. One list: a fixed
// term column from `sm` up, the term above the value below it, an optional note under
// the value.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DescriptionItem, DescriptionList } from './description-list'

const h = (type: unknown, props: object | null, ...children: unknown[]) =>
  createElement(type as never, props as never, ...(children as never[]))

function list(props: object = {}, ...items: unknown[]): string {
  return renderToStaticMarkup(
    h(
      DescriptionList,
      props,
      ...(items.length > 0 ? items : [h(DescriptionItem, { term: 'Status' }, 'Current')]),
    ),
  )
}

describe('DescriptionList', () => {
  it('is a description list whose items are a term followed by its value', () => {
    const html = list()

    expect(html).toMatch(/^<dl /u)
    expect(html).toContain('<dt')
    expect(html).toContain('>Status</dt>')
    expect(html).toContain('<dd')
    expect(html.indexOf('>Status</dt>')).toBeLessThan(html.indexOf('Current'))
    expect(html).toContain('data-slot="description-list"')
  })

  it('groups each term with its value in one div, as a dl allows', () => {
    const html = list()

    expect(html).toMatch(/<dl[^>]*><div[^>]*><dt/u)
  })

  it('names the list when it is given a name', () => {
    expect(list({ 'aria-label': 'Version details' })).toContain(
      'aria-label="Version details"',
    )
  })

  it('mutes the term and leaves the value in the text ink', () => {
    const html = list()

    expect(html).toMatch(/<dt[^>]*text-muted-foreground/u)
    expect(html).not.toMatch(/<dd[^>]*text-muted-foreground/u)
  })

  it('stacks the term above the value on a phone and gives the term a column from sm', () => {
    const html = list()

    expect(html).toContain('sm:grid-cols-[8rem_minmax(0,1fr)]')
  })

  it('has a wider term column for longer terms', () => {
    expect(list({ termWidth: 'wide' })).toContain('sm:grid-cols-[10rem_minmax(0,1fr)]')
    expect(list({ termWidth: 'wide' })).not.toContain('8rem')
  })

  it('stacks the term above the value at every width where it sits among form fields', () => {
    const html = list({ stacked: true })

    expect(html).not.toContain('sm:grid-cols')
    expect(html).toMatch(/<dt[^>]*text-muted-foreground/u)
    expect(html.indexOf('>Status</dt>')).toBeLessThan(html.indexOf('Current'))
  })

  it('lets a long value wrap inside its column instead of widening the list', () => {
    expect(list()).toMatch(/<dd[^>]*min-w-0/u)
  })

  it('prints a note under the value, in the quiet ink', () => {
    const html = list(
      {},
      h(DescriptionItem, { term: 'Address', note: 'From Google' }, '12 Harbour Road'),
    )

    expect(html).toContain('12 Harbour Road')
    expect(html).toMatch(/text-xs text-muted-foreground[^>]*>From Google</u)
    expect(html.indexOf('12 Harbour Road')).toBeLessThan(html.indexOf('From Google'))
  })

  it('marks the language of a value that is in another one', () => {
    const html = list(
      {},
      h(DescriptionItem, { term: 'Title', lang: 'bg' }, 'Добре дошли'),
    )

    expect(html).toMatch(/<dd[^>]*lang="bg"/u)
  })

  it('takes a term that is more than text', () => {
    const html = list(
      {},
      h(DescriptionItem, { term: h('abbr', { title: 'Time zone' }, 'TZ') }, 'UTC'),
    )

    expect(html).toContain('<abbr title="Time zone">TZ</abbr></dt>')
  })
})
