// A card's title is a div unless the page says what level it is (UI consistency scan:
// FORM-10, FRAME-10). Under the page's one h1 a settings section is an h2, so a screen
// reader's outline lists the sections; the same `CardTitle` stays a div where the card
// is a tile and not a section (a goal's matrix, an import step).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CardTitle } from './card'

const render = (props: object = {}) =>
  renderToStaticMarkup(createElement(CardTitle, props, 'Quiet hours'))

describe('CardTitle', () => {
  it('is a plain div by default, as it was', () => {
    expect(render()).toMatch(/^<div data-slot="card-title"/u)
  })

  it.each(['h2', 'h3', 'h4'] as const)(
    'is a real %s when the page gives it a level',
    (as) => {
      expect(render({ as })).toMatch(new RegExp(`^<${as} data-slot="card-title"`, 'u'))
      expect(render({ as })).toMatch(new RegExp(`>Quiet hours</${as}>$`, 'u'))
    },
  )

  it('wears the same type at every level, so the level is semantics and not size', () => {
    const classOf = (as?: string) => /class="([^"]*)"/u.exec(render({ as }))?.[1]

    expect(classOf('h2')).toBe(classOf())
    expect(classOf('h3')).toBe(classOf())
  })

  it('keeps a class the card adds', () => {
    expect(render({ className: 'text-2xl' })).toContain('text-2xl')
  })
})
