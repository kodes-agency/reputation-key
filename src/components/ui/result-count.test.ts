import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultCount, resultCountText } from './result-count'

describe('resultCountText', () => {
  it('reads "N of M"', () => {
    expect(resultCountText(3, 6)).toBe('3 of 6')
  })

  it('never states a total smaller than what is shown', () => {
    // A queue count that lags a new arrival must not say "13 of 12".
    expect(resultCountText(13, 12)).toBe('13 of 13')
  })

  it('says nothing without a total, because "N" alone is not a count', () => {
    expect(resultCountText(3, null)).toBe('')
  })
})

describe('ResultCount', () => {
  const render = (props: Parameters<typeof ResultCount>[0]) =>
    renderToStaticMarkup(createElement(ResultCount, props))

  it('shows the count while the list is narrowed', () => {
    const html = render({ shown: 2, total: 11, active: true })

    expect(html).toContain('>2 of 11<')
    expect(html).toContain('tabular-nums')
  })

  it('stays mounted and empty while the list is not narrowed, so the next count is announced', () => {
    const html = render({ shown: 11, total: 11, active: false })

    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('of 11')
  })

  it('is a polite live region when it has a count too', () => {
    expect(render({ shown: 2, total: 11, active: true })).toContain('aria-live="polite"')
  })

  it('takes a size from the bar it sits in without losing its ink', () => {
    const html = render({ shown: 1, total: 2, active: true, className: 'text-xs' })

    expect(html).toContain('text-xs')
    expect(html).toContain('text-muted-foreground')
  })
})
