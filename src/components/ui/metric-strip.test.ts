import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Metric, MetricStrip, MetricValue } from './metric-strip'

describe('MetricStrip', () => {
  it('is a labelled description list whose cells hold a term and its figure', () => {
    // Arrange / Act
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'Portal results' },
        createElement(
          Metric,
          { label: 'Qualified scans' },
          createElement(MetricValue, { value: '412', detail: '29% of scans' }),
        ),
      ),
    )

    // Assert
    expect(html).toMatch(/^<div class="@container"><dl /)
    expect(html).toContain('aria-label="Portal results"')
    expect(html).toContain('<dt')
    expect(html).toContain('>Qualified scans</dt>')
    expect(html).toContain('<dd')
    expect(html).toContain('412')
    expect(html).toContain('29% of scans')
  })

  it('draws a skeleton in place of the figure while a measure is loading', () => {
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'Results' },
        createElement(
          Metric,
          { label: 'Private ratings', state: 'loading' },
          'never shown',
        ),
      ),
    )

    expect(html).toContain('>Private ratings</dt>')
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain('never shown')
  })

  it('leaves out a measure that is unavailable rather than showing a hollow cell', () => {
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'Results' },
        createElement(Metric, { label: 'Hidden', state: 'unavailable' }, 'x'),
        createElement(Metric, { label: 'Shown' }, 'y'),
      ),
    )

    expect(html).not.toContain('Hidden')
    expect(html).toContain('>Shown</dt>')
  })

  it('prints the boxed look by default and the ruled look on request', () => {
    const boxed = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A' },
        createElement(Metric, { label: 'L' }, 'v'),
      ),
    )
    const ruled = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A', variant: 'ruled' },
        createElement(Metric, { label: 'L' }, 'v'),
      ),
    )

    expect(boxed).toContain('rounded-lg')
    expect(boxed).not.toContain('border-y')
    expect(ruled).toContain('border-y')
    expect(ruled).not.toContain('rounded-lg')
  })

  it('keeps the value and detail lines as plain text a screen reader reads in order', () => {
    const html = renderToStaticMarkup(
      createElement(MetricValue, { value: '4.4', detail: 'from 118' }),
    )

    expect(html.indexOf('4.4')).toBeLessThan(html.indexOf('from 118'))
    expect(html).toContain('tabular-nums')
  })
})
