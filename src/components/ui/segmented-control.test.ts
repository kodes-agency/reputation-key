import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentedControl, type SegmentedControlOption } from './segmented-control'

const LANGUAGES: ReadonlyArray<SegmentedControlOption> = [
  { value: 'en', label: 'EN', accessibleLabel: 'English' },
  { value: 'bg', label: 'BG', accessibleLabel: 'Bulgarian' },
  { value: 'es', label: 'ES', accessibleLabel: 'Spanish', disabled: true },
]

function render(value: string): string {
  return renderToStaticMarkup(
    createElement(SegmentedControl, {
      'aria-label': 'Preview language',
      value,
      onValueChange: () => undefined,
      options: LANGUAGES,
    }),
  )
}

describe('SegmentedControl', () => {
  it('is a named radio group with one radio per option', () => {
    const html = render('en')

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Preview language"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
  })

  it('checks exactly the option whose value is selected', () => {
    const html = render('bg')

    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-checked="true"[^>]*value="bg"/)
    expect(html).toMatch(/aria-checked="false"[^>]*value="en"/)
  })

  it('names each segment with its short label followed by its full name', () => {
    const html = render('en')

    expect(html).toContain('aria-label="EN English"')
    expect(html).toContain('aria-label="BG Bulgarian"')
  })

  it('disables an option that cannot be picked', () => {
    const html = render('en')

    expect(html).toMatch(/disabled=""[^>]*value="es"|value="es"[^>]*disabled=""/)
  })

  it('adds no aria-label to an option with no separate accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        'aria-label': 'Range',
        value: '30',
        onValueChange: () => undefined,
        options: [{ value: '30', label: '30 days' }],
      }),
    )

    expect(html).not.toContain('aria-label="30')
    expect(html).toContain('>30 days<')
  })
})
