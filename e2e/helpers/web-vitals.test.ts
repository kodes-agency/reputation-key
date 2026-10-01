import { describe, expect, test } from 'vitest'
import {
  CLS_BUDGET,
  LCP_BUDGET_MS,
  cumulativeLayoutShift,
  vitalsViolations,
  type LayoutShiftRecord,
  type WebVitals,
} from './web-vitals'

const shift = (
  startTime: number,
  value: number,
  overrides: Partial<LayoutShiftRecord> = {},
): LayoutShiftRecord => ({
  startTime,
  value,
  hadRecentInput: false,
  sources: [],
  ...overrides,
})

const vitals = (overrides: Partial<WebVitals> = {}): WebVitals => ({
  lcp: { startTime: 900, size: 40_000, element: '<img.ih-hero__image>', url: '' },
  shifts: [],
  ...overrides,
})

describe('cumulativeLayoutShift', () => {
  test('is zero when nothing shifted', () => {
    expect(cumulativeLayoutShift([])).toBe(0)
  })

  test('adds shifts that follow each other within a second', () => {
    const total = cumulativeLayoutShift([shift(100, 0.02), shift(700, 0.03)])
    expect(total).toBeCloseTo(0.05, 10)
  })

  test('keeps the worst window when a gap of a second or more separates them', () => {
    const total = cumulativeLayoutShift([
      shift(100, 0.04),
      shift(300, 0.04),
      shift(5000, 0.05),
    ])
    expect(total).toBeCloseTo(0.08, 10)
  })

  test('closes a window five seconds after it opened, however steady the shifts', () => {
    const steady = Array.from({ length: 12 }, (_, index) => shift(index * 600, 0.01))
    // 0..4800 ms is one window of nine shifts; the rest start a second one.
    expect(cumulativeLayoutShift(steady)).toBeCloseTo(0.09, 10)
  })

  test('ignores shifts that follow the guest’s own input', () => {
    const total = cumulativeLayoutShift([
      shift(100, 0.3, { hadRecentInput: true }),
      shift(200, 0.01),
    ])
    expect(total).toBeCloseTo(0.01, 10)
  })

  test('puts unsorted entries in time order first', () => {
    const total = cumulativeLayoutShift([shift(700, 0.03), shift(100, 0.02)])
    expect(total).toBeCloseTo(0.05, 10)
  })
})

describe('vitalsViolations', () => {
  test('is empty for a fast, stable page', () => {
    expect(vitalsViolations('page', vitals())).toEqual([])
  })

  test('names the largest paint element when LCP reaches the budget', () => {
    const lines = vitalsViolations(
      'page',
      vitals({
        lcp: { startTime: LCP_BUDGET_MS, size: 1, element: '<h1.ih-display>', url: '' },
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('LCP')
    expect(lines[0]).toContain('<h1.ih-display>')
  })

  test('accepts an LCP just under the budget', () => {
    const lines = vitalsViolations(
      'page',
      vitals({
        lcp: {
          startTime: LCP_BUDGET_MS - 1,
          size: 1,
          element: '<h1.ih-display>',
          url: '',
        },
      }),
    )
    expect(lines).toEqual([])
  })

  test('fails when no largest contentful paint was reported at all', () => {
    const lines = vitalsViolations('page', vitals({ lcp: null }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('no largest contentful paint')
  })

  test('lists the shifting elements when CLS reaches the budget', () => {
    const lines = vitalsViolations(
      'page',
      vitals({
        shifts: [shift(400, CLS_BUDGET, { sources: ['<footer.ih-footer>'] })],
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('CLS')
    expect(lines[0]).toContain('<footer.ih-footer>')
  })

  test('accepts a CLS under the budget', () => {
    expect(
      vitalsViolations('page', vitals({ shifts: [shift(400, CLS_BUDGET - 0.001)] })),
    ).toEqual([])
  })
})
