// The title of a section that is not in a Card (UI consistency scan: FORM-10, FRAME-10).
//
// Section titles on a settings page came in `font-semibold`, `text-base font-semibold`,
// `text-sm font-medium` and bare `font-medium`, as h2s, h3s and role="heading" divs, and
// 'Pending invitations' was an h3 under no h2. A `CardTitle` is the title of a Card;
// this is the title of everything else, at the same scale: the level is the outline and
// the size is the scale, so the two are chosen apart.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SectionTitle } from './section-title'

const render = (props: object = {}) =>
  renderToStaticMarkup(createElement(SectionTitle, props, 'Members'))

describe('SectionTitle', () => {
  it('is an h2 by default: a section under the page’s one h1', () => {
    expect(render()).toMatch(/^<h2 data-slot="section-title"/u)
    expect(render()).toMatch(/text-base font-semibold/u)
  })

  it('is an h3 for a part of a section, a step smaller', () => {
    expect(render({ level: 3 })).toMatch(/^<h3 data-slot="section-title"/u)
    expect(render({ level: 3 })).toMatch(/text-sm font-medium/u)
  })

  it('takes an id, so a section can be named by it', () => {
    expect(render({ id: 'members-heading' })).toContain('id="members-heading"')
  })

  it('keeps a class the place adds, such as the space under it', () => {
    expect(render({ className: 'mb-3' })).toContain('mb-3')
  })
})
