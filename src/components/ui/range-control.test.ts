import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RangeControl, type RangeOption } from './range-control'

const OPTIONS: ReadonlyArray<RangeOption<'30d' | '90d' | 'all'>> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

function render(extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(RangeControl<'30d' | '90d' | 'all'>, {
      value: '90d',
      onValueChange: () => undefined,
      options: OPTIONS,
      ...extra,
    }),
  )
}

describe('RangeControl', () => {
  it('is a segmented control named "Time range" where a row of segments fits', () => {
    const html = render()

    expect(html).toContain('data-slot="segmented-control"')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Time range"')
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).toContain('>All time<')
  })

  it('checks the segment whose value is the range', () => {
    const html = render()

    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-checked="true"[^>]*value="90d"/)
  })

  it('draws the segments as tap targets below md', () => {
    expect(render()).toContain('max-md:min-h-[calc(var(--control-touch)-0.25rem)]')
  })

  it('shows the segments from sm and a Select below it, never both', () => {
    const html = render()

    expect(html).toMatch(
      /class="[^"]*\bhidden\b[^"]*\bsm:inline-flex\b[^"]*"[^>]*data-slot="segmented-control"|data-slot="segmented-control"[^>]*class="[^"]*\bhidden\b[^"]*\bsm:inline-flex\b/,
    )
    expect(html).toContain('sm:hidden')
    expect(html).toContain('role="combobox"')
  })

  it('names the Select the same as the segments, so the control has one name at any width', () => {
    const html = render({ label: 'Reporting window' })

    expect(html.match(/aria-label="Reporting window"/g)).toHaveLength(2)
    expect(html).not.toContain('aria-label="Time range"')
  })

  it('prints the chosen option in the Select', () => {
    expect(render({ value: 'all' })).toContain('All time')
  })
})
