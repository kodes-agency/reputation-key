// Core Web Vitals for a Chromium page, read through PerformanceObservers.
//
// Two numbers, both judged against the budget in
// `.claude/rules/web/performance.md` (LCP < 2.5 s, CLS < 0.1):
//
//   - LCP is the start time of the LAST largest-contentful-paint entry the page
//     reported, which is how the metric is defined (a later, larger paint
//     replaces an earlier one until the guest interacts or the page is hidden);
//   - CLS is the worst SESSION WINDOW of layout shifts, not their sum: shifts
//     less than a second apart join one window, and a window closes five
//     seconds after it opened. Shifts that follow the guest's own input do not
//     count. This is the definition Chrome's own tooling uses (web.dev/cls).
//
// The observers are installed with `addInitScript`, before any page script,
// and registered `buffered: true`, so a shift or a paint that happened before
// the read is still in the list. Entries reach an observer on a later task, so
// `readWebVitals` drains each observer's queue (`takeRecords`) first; without
// it a shift in the last frame before the read goes unseen and the page passes.
//
// Chromium only: `largest-contentful-paint` and `layout-shift` are not
// exposed by WebKit or Firefox as of this writing. The pure half of this file
// (the verdicts) has unit tests; the page half runs in the two gates that use
// it (`e2e/storybook-metrics/guest-vitals.metrics.ts`, and the seeded-portal
// check slice 19 adds).

import type { Page } from '@playwright/test'

/** `.claude/rules/web/performance.md`: LCP < 2.5 s. */
export const LCP_BUDGET_MS = 2500
/** `.claude/rules/web/performance.md`: CLS < 0.1. */
export const CLS_BUDGET = 0.1

/** A gap this long, or longer, closes a session window. */
const SESSION_GAP_MS = 1000
/** A window never runs longer than this from its first shift. */
const SESSION_CAP_MS = 5000

export type LcpRecord = Readonly<{
  /** Milliseconds from navigation start to the paint. */
  startTime: number
  /** Painted area in px². */
  size: number
  /** `<tag.class>` of the element, so a red run says what to look at. */
  element: string
  /** The image URL, or `''` for text and for `data:` images. */
  url: string
}>

export type LayoutShiftRecord = Readonly<{
  startTime: number
  value: number
  hadRecentInput: boolean
  /** `<tag.class>` of each element that moved. */
  sources: ReadonlyArray<string>
}>

export type WebVitals = Readonly<{
  lcp: LcpRecord | null
  shifts: ReadonlyArray<LayoutShiftRecord>
}>

/** The worst session window of layout shifts, as the CLS number. */
export function cumulativeLayoutShift(shifts: ReadonlyArray<LayoutShiftRecord>): number {
  const counted = shifts
    .filter((entry) => !entry.hadRecentInput)
    .sort((a, b) => a.startTime - b.startTime)
  let worst = 0
  let window = 0
  let windowStart = 0
  let previous = 0
  for (const entry of counted) {
    const joinsWindow =
      window > 0 &&
      entry.startTime - previous < SESSION_GAP_MS &&
      entry.startTime - windowStart < SESSION_CAP_MS
    if (joinsWindow) {
      window += entry.value
    } else {
      window = entry.value
      windowStart = entry.startTime
    }
    previous = entry.startTime
    worst = Math.max(worst, window)
  }
  return worst
}

const ms = (value: number): string => `${Math.round(value)} ms`

/** One line per budget the page misses. `label` says which page, in the line. */
export function vitalsViolations(
  label: string,
  vitals: WebVitals,
): ReadonlyArray<string> {
  const lines: string[] = []
  if (vitals.lcp === null) {
    lines.push(
      `${label}: the page reported no largest contentful paint, so LCP was not measured`,
    )
  } else if (vitals.lcp.startTime >= LCP_BUDGET_MS) {
    lines.push(
      `${label}: LCP ${ms(vitals.lcp.startTime)} must be under ${LCP_BUDGET_MS} ms; ` +
        `the largest paint is ${vitals.lcp.element}` +
        (vitals.lcp.url ? ` (${vitals.lcp.url})` : ''),
    )
  }
  const cls = cumulativeLayoutShift(vitals.shifts)
  if (cls >= CLS_BUDGET) {
    const movers = [
      ...new Set(
        vitals.shifts
          .filter((entry) => !entry.hadRecentInput)
          .flatMap((entry) => entry.sources),
      ),
    ]
    lines.push(
      `${label}: CLS ${cls.toFixed(3)} must be under ${CLS_BUDGET}; moved: ` +
        (movers.length > 0 ? movers.join(', ') : 'no element was reported'),
    )
  }
  return lines
}

type VitalsWindow = Window & {
  __webVitals?: {
    lcp: LcpRecord | null
    shifts: LayoutShiftRecord[]
    drain: () => void
  }
}

/**
 * Runs in the page before any of its scripts (`page.addInitScript`), so it may
 * reference nothing outside its own body.
 */
function observeWebVitals(): void {
  const describe = (node: Node | null | undefined): string => {
    if (!(node instanceof Element)) return '(removed element)'
    const classes = (node.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)
    return `<${node.tagName.toLowerCase()}${classes.length > 0 ? `.${classes.slice(0, 2).join('.')}` : ''}>`
  }
  const store: NonNullable<VitalsWindow['__webVitals']> = {
    lcp: null,
    shifts: [],
    drain: () => undefined,
  }
  const observers: PerformanceObserver[] = []
  const take = (entries: PerformanceEntryList): void => {
    for (const entry of entries) {
      if (entry.entryType === 'largest-contentful-paint') {
        const paint = entry as PerformanceEntry & {
          size: number
          url: string
          element: Element | null
        }
        store.lcp = {
          startTime: paint.startTime,
          size: paint.size,
          element: describe(paint.element),
          url: paint.url.startsWith('data:') ? '' : paint.url,
        }
      } else if (entry.entryType === 'layout-shift') {
        const shift = entry as PerformanceEntry & {
          value: number
          hadRecentInput: boolean
          sources?: ReadonlyArray<{ node: Node | null }>
        }
        store.shifts.push({
          startTime: shift.startTime,
          value: shift.value,
          hadRecentInput: shift.hadRecentInput,
          sources: (shift.sources ?? []).map((source) => describe(source.node)),
        })
      }
    }
  }
  for (const type of ['largest-contentful-paint', 'layout-shift']) {
    const observer = new PerformanceObserver((list) => take(list.getEntries()))
    observer.observe({ type, buffered: true })
    observers.push(observer)
  }
  store.drain = () => {
    for (const observer of observers) take(observer.takeRecords())
  }
  ;(window as VitalsWindow).__webVitals = store
}

/** Install the observers; call before `page.goto`. */
export async function installWebVitals(page: Page): Promise<void> {
  await page.addInitScript(observeWebVitals)
}

/** What the page has reported so far. Waits for fonts, then paints, first. */
export async function readWebVitals(page: Page): Promise<WebVitals> {
  return page.evaluate(async () => {
    await document.fonts.ready
    // Two frames: whatever a font swap or a post-hydration effect moved has been
    // laid out and painted, so the browser has produced its entries.
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    )
    const store = (window as VitalsWindow).__webVitals
    if (store === undefined) {
      throw new Error('installWebVitals(page) was not called before the page loaded')
    }
    store.drain()
    return { lcp: store.lcp, shifts: [...store.shifts] }
  })
}
