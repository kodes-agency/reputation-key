// What the after-rating page gives assistive technology: a name for Change, a
// place for focus to land once the guest's own controls are gone, and the
// Google hint read with its button. Focus itself moves in the browser, so the
// stories hold that; what is pinned here is the markup it needs.

import { describe, expect, it } from 'vitest'
import { directChildren } from '../__fixtures__/markup-walk'
import {
  PACKS,
  RATINGS,
  renderResponse,
} from './__fixtures__/immersive-response-fixtures'

const responseChildren = (html: string) => directChildren(html, 'data-ih-response')
const body = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

describe.each(PACKS)('after a rating, for assistive technology [$locale]', (pack) => {
  const rendered = RATINGS.map((rating) => ({
    rating,
    html: body(renderResponse(pack, { kind: 'rated', rating })),
  }))
  const googleIndex = (children: readonly string[]) =>
    children.findIndex((child) => child.includes(pack.copy.googleTitle))

  it('keeps its visible word as the name of Change and describes it with the receipt (WCAG 2.5.3)', () => {
    const [strip] = responseChildren(rendered[0]?.html ?? '')
    expect(/<button[^>]*aria-label=/u.test(strip ?? '')).toBe(false)
    const describedBy = /<button[^>]*aria-describedby="([^"]+)"[^>]*>/u.exec(
      strip ?? '',
    )?.[1]
    expect(describedBy).toBeTruthy()
    expect(strip).toContain(`id="${describedBy}"`)
    expect(strip).toMatch(new RegExp(`<button[^>]*>${pack.copy.ratingChange}</button>`))
  })

  it('lets focus land on the receipt heading when a rating has just been sent', () => {
    const [strip] = responseChildren(rendered[0]?.html ?? '')
    expect(strip).toMatch(/<h2[^>]*tabindex="-1"[^>]*>/u)
  })

  it('links the Google hint to the Google button, at every rating', () => {
    for (const { rating, html } of rendered) {
      const children = responseChildren(html)
      const card = children[googleIndex(children)] ?? ''
      const hint = new RegExp(`<p[^>]*id="([^"]+)"[^>]*>${pack.copy.googleHint}</p>`, 'u')
      const id = hint.exec(card)?.[1]
      expect(id, `rating ${rating}`).toBeTruthy()
      expect(card).toMatch(new RegExp(`<button[^>]*aria-describedby="${id}"`, 'u'))
    }
  })

  it('lets focus land on the sent-note confirmation', () => {
    const html = body(renderResponse(pack, { kind: 'done', rating: 2 }))
    const [, , note] = responseChildren(html)
    expect(note).toMatch(/<p[^>]*tabindex="-1"[^>]*>/u)
  })
})
