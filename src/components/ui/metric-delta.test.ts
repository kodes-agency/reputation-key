// A period-over-period change is drawn one way everywhere: a direction arrow, the
// size of the change, the baseline it is measured against, and the direction in
// words for a reader who cannot see the colour or the arrow.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MetricDelta, metricDeltaDirection } from './metric-delta'

const BASELINE = 'vs the previous 90 days'

const render = (props: Parameters<typeof MetricDelta>[0]) =>
  renderToStaticMarkup(createElement(MetricDelta, props))

describe('metricDeltaDirection', () => {
  it('reads the sign of the change', () => {
    expect(metricDeltaDirection(0.2)).toBe('up')
    expect(metricDeltaDirection(-12.5)).toBe('down')
    expect(metricDeltaDirection(0)).toBe('flat')
  })

  it('calls a change flat when it rounds away at the digits shown', () => {
    expect(metricDeltaDirection(0.04, 1)).toBe('flat')
    expect(metricDeltaDirection(-0.04, 1)).toBe('flat')
    expect(metricDeltaDirection(0.04, 2)).toBe('up')
  })
})

describe('MetricDelta', () => {
  it('draws a rise with the positive ink, an arrow, the size and the baseline', () => {
    const html = render({ value: 0.2, comparisonLabel: BASELINE })

    expect(html).toContain('data-slot="metric-delta"')
    expect(html).toContain('data-direction="up"')
    expect(html).toContain('text-positive')
    expect(html).toContain('0.2')
    expect(html).toContain(BASELINE)
  })

  it('draws a fall with the negative ink, never the fill-grade destructive one', () => {
    const html = render({ value: -3.14, comparisonLabel: BASELINE })

    expect(html).toContain('data-direction="down"')
    expect(html).toContain('text-negative')
    expect(html).not.toContain('text-destructive')
    expect(html).toContain('3.1')
  })

  it('says the direction in words and hides the arrow from assistive technology', () => {
    const up = render({ value: 5, comparisonLabel: BASELINE })
    const down = render({ value: -5, comparisonLabel: BASELINE })

    expect(up).toContain('<span class="sr-only">Up </span>')
    expect(down).toContain('<span class="sr-only">Down </span>')
    expect(up).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(down).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('prints a percent sign for a percent change and none for a point change', () => {
    expect(render({ value: 12.5, unit: 'percent', comparisonLabel: BASELINE })).toContain(
      '12.5%',
    )
    expect(render({ value: 12.5, comparisonLabel: BASELINE })).not.toContain('%')
  })

  it('keeps the decimal of a rating change, as the figure beside it does', () => {
    expect(render({ value: 1, comparisonLabel: BASELINE })).toContain('1.0 vs')
    expect(render({ value: -2, comparisonLabel: BASELINE })).toContain('2.0 vs')
    expect(render({ value: 0.2, comparisonLabel: BASELINE })).toContain('0.2 vs')
    expect(render({ value: 1, fractionDigits: 0, comparisonLabel: BASELINE })).toContain(
      '1 vs',
    )
  })

  it('keeps as many digits as it is told to and drops trailing zeros of a percent', () => {
    expect(render({ value: 12, unit: 'percent', comparisonLabel: BASELINE })).toContain(
      '12%',
    )
    expect(
      render({ value: 12.349, unit: 'percent', fractionDigits: 0, comparisonLabel: 'x' }),
    ).toContain('12%')
  })

  it('groups thousands in a large change', () => {
    expect(render({ value: 1234, unit: 'percent', comparisonLabel: BASELINE })).toContain(
      '1,234%',
    )
  })

  it('says "No change" without a tone or an arrow when nothing moved', () => {
    const html = render({ value: 0, comparisonLabel: BASELINE })

    expect(html).toContain('data-direction="flat"')
    expect(html).toContain(`No change ${BASELINE}`)
    expect(html).not.toContain('text-positive')
    expect(html).not.toContain('text-negative')
    expect(html).not.toContain('<svg')
  })

  it('says "No change" for a move too small to show', () => {
    const html = render({ value: 0.04, comparisonLabel: BASELINE })

    expect(html).toContain(`No change ${BASELINE}`)
  })

  it('takes a class from the caller for placement', () => {
    expect(
      render({ value: 1, comparisonLabel: BASELINE, className: 'text-xs' }),
    ).toContain('text-xs')
  })
})

describe('period-over-period deltas', () => {
  const ROOT = join(import.meta.dirname, '..', '..', '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return /\.tsx$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
        ? [path]
        : []
    })

  it('are never drawn with a hand-typed arrow glyph beside a figure', () => {
    const offenders = ['src/components', 'src/routes']
      .flatMap((source) => walk(join(ROOT, source)))
      .filter((path) => /[↑↓]/u.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))

    expect(offenders).toEqual([])
  })
})
