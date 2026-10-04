import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Metric,
  METRIC_LABEL_CLASS,
  METRIC_TILE_FIGURE_CLASS,
  MetricStrip,
  MetricValue,
} from './metric-strip'

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
    expect(boxed).not.toContain('@3xl:rounded-none')
    expect(ruled).toContain('@3xl:rounded-none')
    expect(ruled).not.toContain('bg-border')
  })

  it('keeps the value and detail lines as plain text a screen reader reads in order', () => {
    const html = renderToStaticMarkup(
      createElement(MetricValue, { value: '4.4', detail: 'from 118' }),
    )

    expect(html.indexOf('4.4')).toBeLessThan(html.indexOf('from 118'))
    expect(html).toContain('tabular-nums')
  })

  it('sizes a ruled figure 20/24 bold on a phone and 24/32 bold from 3xl, tightened', () => {
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A', variant: 'ruled' },
        createElement(
          Metric,
          { label: 'L' },
          createElement(MetricValue, { value: '9', detail: 'd' }),
        ),
      ),
    )

    expect(html).toContain('text-xl')
    expect(html).toContain('leading-6')
    expect(html).toContain('font-bold')
    expect(html).toContain('@3xl:text-2xl')
    expect(html).toContain('@3xl:leading-8')
    expect(html).toContain('tracking-[-0.3px]')
    expect(html).toContain('gap-0.5')
  })

  it('boxes a ruled strip on a phone and rules it from 3xl, as the phone board draws it', () => {
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A', variant: 'ruled' },
        createElement(Metric, { label: 'L' }, 'v'),
      ),
    )

    expect(html).toContain('rounded-lg')
    expect(html).toContain('border ')
    expect(html).toContain('@3xl:rounded-none')
    expect(html).toContain('@3xl:border-x-0')
    expect(html).toContain('px-3')
    expect(html).toContain('py-2.5')
    expect(html).toContain('@3xl:px-4')
  })

  it('sizes the loading skeleton to the look so a figure arriving does not shift the cell', () => {
    const skeleton = (variant: 'boxed' | 'ruled') =>
      renderToStaticMarkup(
        createElement(
          MetricStrip,
          { 'aria-label': 'A', variant },
          createElement(Metric, { label: 'L', state: 'loading' }),
        ),
      )

    expect(skeleton('boxed')).toContain('h-11')
    expect(skeleton('ruled')).toContain('h-12')
    expect(skeleton('ruled')).not.toContain('h-11')
  })
})

describe('MetricStrip tiles and embedded looks (COLL-04)', () => {
  const strip = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A', ...props } as never,
        createElement(
          Metric,
          { label: 'L' },
          createElement(MetricValue, { value: '9', detail: 'd' }),
        ),
      ),
    )

  it('draws separate bordered tiles that wrap, in two columns narrow and four from 2xl', () => {
    const html = strip({ variant: 'tiles' })

    expect(html).toContain('data-variant="tiles"')
    expect(html).toContain('gap-3')
    expect(html).toContain('@2xl:grid-cols-4')
    expect(html).toContain('rounded-lg border p-4')
    // Tiles wrap: they are never one row, and a lone last tile does not span.
    expect(html).not.toContain('@3xl:flex')
    expect(html).not.toContain('col-span-2')
  })

  it('has three columns for a longer set', () => {
    expect(strip({ variant: 'tiles', columns: 3 })).toContain('@2xl:grid-cols-3')
    expect(strip({ variant: 'tiles', columns: 3 })).not.toContain('@2xl:grid-cols-4')
  })

  it('sizes a tile figure 24/32 semibold, between the boxed and the ruled figure', () => {
    const html = strip({ variant: 'tiles' })

    expect(html).toContain('text-2xl leading-8 font-semibold')
    expect(METRIC_TILE_FIGURE_CLASS).toContain('text-2xl')
    expect(METRIC_TILE_FIGURE_CLASS).toContain('tabular-nums')
  })

  it('draws a card-embedded strip as the boxed cells with no frame of their own', () => {
    const html = strip({ variant: 'embedded' })

    expect(html).toContain('gap-px')
    expect(html).toContain('bg-border')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toMatch(/[\s"]border[\s"]/u)
    expect(html).toContain('bg-card')
  })

  it('takes a term that is more than text, such as a glossary entry', () => {
    const html = renderToStaticMarkup(
      createElement(
        MetricStrip,
        { 'aria-label': 'A' },
        createElement(
          Metric,
          { label: createElement('abbr', { title: 'Reply rate' }, 'RR') },
          'v',
        ),
      ),
    )

    expect(html).toContain('<abbr title="Reply rate">RR</abbr></dt>')
  })

  it('shares its label recipe with anything that prints a term over a figure', () => {
    expect(METRIC_LABEL_CLASS).toBe('text-xs font-medium text-muted-foreground')
    expect(strip({ variant: 'tiles' })).toContain(METRIC_LABEL_CLASS)
  })
})
