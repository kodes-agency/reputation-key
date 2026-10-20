// The detail layout and the tiles as the server draws them. The Google rating
// goal passes the tiles a full strip; the branches below are the ones a goal that
// passes less (no tiles to show, a tile with no figure) takes, and a branch no
// test names would change under it unseen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalDetailLayout, GoalTiles } from './goal-detail-layout'

const layout = () =>
  renderToStaticMarkup(
    createElement(
      GoalDetailLayout,
      { slot: 'a-goal-detail' },
      createElement('p', null, 'first'),
      createElement('p', null, 'second'),
    ),
  )

const tiles = (props: Partial<Parameters<typeof GoalTiles>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GoalTiles, {
      title: 'So far',
      headingId: 'a-goal-tiles',
      label: 'So far, in numbers',
      tiles: [
        { key: 'a', label: 'This one', value: '12 of 40', detail: '9 days left' },
        { key: 'b', label: 'The one before', value: null, detail: 'No goal yet' },
        { key: 'c', label: 'Usual', value: '38', detail: null },
      ],
      ...props,
    }),
  )

describe('GoalDetailLayout', () => {
  it('stacks its blocks in the order they were given, under the slot it was given', () => {
    const html = layout()

    expect(html).toContain('data-slot="a-goal-detail"')
    expect(html).toContain('flex flex-col gap-6')
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('second'))
  })
})

describe('GoalTiles', () => {
  it('is a section named by its title, with the strip named for a screen reader', () => {
    const html = tiles()

    expect(html).toContain('aria-labelledby="a-goal-tiles"')
    expect(html).toMatch(/<h2[^>]* id="a-goal-tiles"[^>]*>So far<\/h2>/u)
    expect(html).toContain('aria-label="So far, in numbers"')
  })

  it('lays the tiles out one to a column below 42rem and three across from it', () => {
    const html = tiles()

    expect(html).toContain('@2xl:grid-cols-3')
    expect(html).toContain('@max-2xl:grid-cols-1')
  })

  it('prints a tile with no figure as its detail alone', () => {
    const html = tiles()

    expect(html).toContain('No goal yet')
    expect(html).not.toContain('null')
  })

  it('draws a tile with no detail as its figure alone', () => {
    const html = tiles({
      tiles: [{ key: 'c', label: 'Usual', value: '38', detail: null }],
    })

    expect(html).toContain('38')
    expect(html).not.toContain('<span class="text-xs text-muted-foreground">')
  })

  it('draws nothing when there are no tiles to show, not an empty section', () => {
    expect(tiles({ tiles: [] })).toBe('')
  })
})
