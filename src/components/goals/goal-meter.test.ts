// The goal meter as the server draws it: a quiet caption, the figure, a bar with no
// verdict and a foot line, every one of them optional but the figure and the bar. A
// goal's way on a ruler (a tick, the way's two ends) is the goal ruler, not the meter.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GoalMeter } from './goal-meter'

const BAR = { value: 3, max: 7, label: 'Counted', valueText: '3 of 7 counted' } as const

const meter = (props: Partial<Parameters<typeof GoalMeter>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GoalMeter, {
      slot: 'a-goal-meter',
      caption: 'A quiet caption',
      figure: '3 of 7',
      bar: BAR,
      foot: 'A foot line',
      ...props,
    }),
  )

describe('GoalMeter', () => {
  it('draws at every width, in the column the card gives it', () => {
    expect(meter()).toContain('class="flex flex-col gap-1.5"')
  })

  it('draws the caption, the figure, the bar and the foot in that order, under the slot it was given', () => {
    const html = meter()

    expect(html).toContain('data-slot="a-goal-meter"')
    expect(html.indexOf('A quiet caption')).toBeLessThan(html.indexOf('3 of 7</p>'))
    expect(html.indexOf('3 of 7</p>')).toBeLessThan(html.indexOf('role="progressbar"'))
    expect(html.indexOf('role="progressbar"')).toBeLessThan(html.indexOf('A foot line'))
    expect(html).toContain('aria-label="Counted"')
    expect(html).toContain('aria-valuetext="3 of 7 counted"')
  })

  it('gives the bar its value and its end for a reader who cannot see it', () => {
    const html = meter()

    expect(html).toContain('aria-valuenow="3"')
    expect(html).toContain('aria-valuemax="7"')
    expect(html).toContain('data-tone="neutral"')
  })

  it('draws no caption and no foot when the goal has none to add', () => {
    const html = meter({ caption: null, foot: null })

    expect(html).not.toContain('text-muted-foreground')
    expect(html).toContain('3 of 7</p>')
    expect(html).toContain('role="progressbar"')
  })

  it('draws the bar alone under the figure: no tick and no ends beside it', () => {
    const html = meter()

    expect(html.match(/role="progressbar"/gu)).toHaveLength(1)
    expect(html).not.toContain('goal-meter-tick')
    expect(html).not.toContain('goal-meter-bar')
    expect(html).not.toContain('aria-hidden')
  })
})
