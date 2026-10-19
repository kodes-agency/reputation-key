// The goal meter as the server draws it. Its placements are spelled whole
// because `rating-goal-card.test.ts` pins the Google meter's class string in
// that order; these name the branches that goal never takes (no caption, no
// foot), which the other goal's meter will.
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
  it('draws at every width unless it is wide-only', () => {
    expect(meter()).toContain('class="flex flex-col gap-1.5"')
    expect(meter({ wideOnly: false })).toContain('class="flex flex-col gap-1.5"')
  })

  it('draws only on a card 48rem wide when it is wide-only, the classes in the order the Google card pins', () => {
    expect(meter({ wideOnly: true })).toContain(
      'class="hidden flex-col gap-1.5 @3xl:flex"',
    )
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

  it('draws no caption and no foot when the goal has none to add', () => {
    const html = meter({ caption: null, foot: null })

    expect(html).not.toContain('text-muted-foreground')
    expect(html).toContain('3 of 7</p>')
    expect(html).toContain('role="progressbar"')
  })
})
