// The slider's markup and its scale. The keys, the pointer and the value it
// holds are proved in the browser (slider.stories.tsx): Radix places the thumb
// and says `aria-valuenow` only once it has mounted. This pins what the server
// draws: a named `slider` with its range and the caller's words, a `limit`
// announced as the highest value, and the stretch past it drawn and kept from
// assistive technology.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Slider, sliderPercent, type SliderProps } from './slider'

const render = (
  patch: Partial<Omit<SliderProps, 'aria-label' | 'aria-labelledby'>> = {},
) =>
  renderToStaticMarkup(
    createElement(Slider, {
      'aria-label': 'Goal on Google',
      value: 44,
      onValueChange: () => undefined,
      min: 44,
      max: 50,
      valueText: (value: number) => `${value / 10} stars`,
      ...patch,
    }),
  )

describe('sliderPercent', () => {
  it('places a value on its scale and keeps it inside', () => {
    expect(sliderPercent(47, 44, 50)).toBe(50)
    expect(sliderPercent(40, 44, 50)).toBe(0)
    expect(sliderPercent(60, 44, 50)).toBe(100)
  })

  it('answers 0 for a scale with no length', () => {
    expect(sliderPercent(44, 44, 44)).toBe(0)
  })
})

describe('Slider', () => {
  it('is a named slider that reads its value in words', () => {
    const html = render()

    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-label="Goal on Google"')
    expect(html).toContain('aria-valuemin="44"')
    expect(html).toContain('aria-valuemax="50"')
    expect(html).toContain('aria-valuetext="4.4 stars"')
    expect(html).not.toContain('data-slot="slider-beyond"')
  })

  it('announces its limit as the highest value and draws the rest of the scale apart', () => {
    const html = render({ limit: 49, value: 50 })

    expect(html).toContain('aria-valuemax="49"')
    expect(html).toContain('aria-valuetext="4.9 stars"')
    expect(html).toMatch(/data-slot="slider-beyond" aria-hidden="true"/u)
  })
})
