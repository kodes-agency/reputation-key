// LoadMoreButton (UI consistency scan: COLL-16).
//
// A cursor feed's "Load more" was four buttons: an outline Button with a spinner and
// a count above it (the Inbox), a full-width ghost one that went aria-disabled
// (Notifications), a disabled one that swapped its text (Portal history) and a
// pending outline one beside a footer (Google import). One recipe now: an outline
// Button that, while a page loads, shows a spinner and "Loading…" and is
// aria-disabled, never disabled, so a focused button keeps its focus. The numbered
// pager of the Portals list is a different control and stays.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoadMoreButton } from './load-more-button'

type Props = Parameters<typeof LoadMoreButton>[0]

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(LoadMoreButton, {
      loading: false,
      onLoadMore: () => undefined,
      ...props,
    }),
  )
}

describe('LoadMoreButton', () => {
  it('is an outline button that says "Load more"', () => {
    const html = render()

    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('data-size="sm"')
    expect(html).toContain('type="button"')
    expect(html).toContain('>Load more</button>')
  })

  it('says what it loads when the feed has a noun', () => {
    expect(render({ label: 'Load earlier activity' })).toContain(
      '>Load earlier activity<',
    )
  })

  it('shows a spinner and "Loading…" while a page loads', () => {
    const html = render({ loading: true })

    expect(html).toContain('animate-spin')
    expect(html).toContain('motion-reduce:animate-none')
    expect(html).toContain('Loading…')
    expect(html).not.toContain('Load more')
  })

  it('is aria-disabled and busy while it loads, never disabled, so a focused button keeps focus', () => {
    const html = render({ loading: true })

    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/u)
  })

  it('is not marked busy or disabled while idle', () => {
    const html = render()

    expect(html).not.toContain('aria-disabled="')
    expect(html).not.toContain('aria-busy="')
  })

  it('offers "Try again" after a failed attempt, in the same place', () => {
    const html = render({ failed: true })

    expect(html).toContain('>Try again<')
    expect(html).not.toContain('Load more')
  })

  it('shows the busy state, not the failure, while the retry loads', () => {
    expect(render({ failed: true, loading: true })).toContain('Loading…')
  })

  it('can fill its column, for a list at the foot of a card', () => {
    expect(render({ block: true })).toContain('w-full')
    expect(render()).not.toContain('w-full')
  })

  it('passes data attributes through, as a list that restores focus needs', () => {
    expect(render({ 'data-list-control': 'load-more' } as Partial<Props>)).toContain(
      'data-list-control="load-more"',
    )
  })
})
