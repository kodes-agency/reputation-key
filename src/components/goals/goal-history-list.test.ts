// The History list as the server draws it. The Google rating goal passes the list
// its rows and a foot and nothing else; the branches below are the ones a goal that
// asks for more takes (a landmark, a control under the list, a row that takes the
// focus), and a branch no test names would change under it unseen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalHistoryList } from './goal-history-list'

const rows = [
  { key: 'a', when: 'Oct 23', content: createElement('span', null, 'First fact') },
  { key: 'b', when: 'Oct 9', content: createElement('span', null, 'Second fact') },
  { key: 'c', when: 'Sep 1', content: createElement('span', null, 'Third fact') },
]

const list = (props: Partial<Parameters<typeof GoalHistoryList>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GoalHistoryList, { title: 'What happened', rows, ...props }),
  )

/** The row (an li) that holds this text, as drawn: its opening tag. */
const rowTag = (html: string, text: string) => {
  const end = html.indexOf(text)
  return html.slice(
    html.lastIndexOf('<li', end),
    html.indexOf('>', html.lastIndexOf('<li', end)) + 1,
  )
}

describe('GoalHistoryList', () => {
  it('draws the title as an h2, then one row to a fact, the date before its words', () => {
    const html = list()

    expect(html).toMatch(/<h2 data-slot="card-title"[^>]*>What happened<\/h2>/u)
    expect(html.match(/<li/gu)).toHaveLength(3)
    expect(html.indexOf('Oct 23')).toBeLessThan(html.indexOf('First fact'))
    expect(html.indexOf('First fact')).toBeLessThan(html.indexOf('Oct 9'))
  })

  it('is no landmark unless asked: the title only heads the card', () => {
    const html = list()

    expect(html).not.toContain('role="region"')
    expect(html).not.toContain('aria-labelledby')
    expect(html).not.toMatch(/<h2[^>]* id=/u)
  })

  it('is a region named by its title when asked', () => {
    const html = list({ region: true })
    const titleId = html.match(/<h2[^>]* id="([^"]+)"/u)?.[1]

    expect(titleId).toBeDefined()
    expect(html).toContain('role="region"')
    expect(html).toContain(`aria-labelledby="${titleId}"`)
  })

  it('draws the foot and the control under the list, the control first', () => {
    const html = list({
      foot: createElement('p', null, 'The foot'),
      more: createElement('button', null, 'Show more'),
    })

    expect(html.indexOf('Third fact')).toBeLessThan(html.indexOf('Show more'))
    expect(html.indexOf('Show more')).toBeLessThan(html.indexOf('The foot'))
  })

  it('draws neither a foot nor a control when it is given none', () => {
    const html = list()

    expect(html).not.toContain('<button')
    expect(html).not.toContain('<p')
  })

  it('makes no row focusable by script unless a control revealed it', () => {
    expect(list()).not.toContain('tabindex')
    expect(list({ revealedFrom: null })).not.toContain('tabindex')
  })

  it('sends the focus to the row the control revealed, with no ring of its own', () => {
    const html = list({ revealedFrom: 1 })

    expect(rowTag(html, 'Second fact')).toContain('tabindex="-1"')
    expect(rowTag(html, 'Second fact')).toContain('outline-none')
    expect(rowTag(html, 'First fact')).not.toContain('tabindex')
    expect(rowTag(html, 'Third fact')).not.toContain('tabindex')
  })

  it('names no row when the control revealed one past the end', () => {
    expect(list({ revealedFrom: 3 })).not.toContain('tabindex')
  })
})
