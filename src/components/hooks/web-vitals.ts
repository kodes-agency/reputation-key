// BETA-2 B2.7: Core Web Vitals instrumentation — WIRED in BQC-6.8.
//
// Lives in components/hooks (not shared/observability) because the vite import
// protection denies shared/observability/** to the client bundle — and this
// module is client-only instrumentation by nature.
//
// What it collects: LCP (largest-contentful-paint) and CLS (layout-shift) via
// PerformanceObserver, flushed when the page goes hidden (the standard
// collection point — LCP/CLS are final at that moment). INP is deliberately
// NOT collected: honest INP needs event-timing entries with a duration
// threshold plus interaction-id correlation to attribute the worst
// interaction, which is a much larger surface; LCP + CLS cover the
// load/stability budgets this slice enforces. INP is registered as a BQC-7
// follow-up alongside the reporting destination.
//
// Where it reports: the VitalReporter seam. The default reporter console.debugs
// in dev and no-ops in production — no endpoint exists today; the reporting
// destination (Sentry / collector) is registered as BQC-7. Only privacy-safe
// dimensions are ever attached (metric name/value/rating + route path) — no
// user IDs, review content, etc.
//
// Usage:
//   import { initWebVitals } from '#/components/hooks/web-vitals'
//   initWebVitals()  // called once from the client root (src/routes/__root.tsx)

export type VitalMetric = {
  name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  // Only privacy-safe dimensions — no user IDs, review content, etc.
  route?: string
}

export type VitalReporter = (metric: VitalMetric) => void

// Default reporter: logs to console in dev, no-ops in production until a real
// collector is wired (reporting destination registered as BQC-7).
const defaultReporter: VitalReporter = (metric) => {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      `[Web Vitals] ${metric.name}: ${metric.value.toFixed(0)} (${metric.rating})`,
    )
  }
}

let activeReporter: VitalReporter = defaultReporter

/**
 * Set a custom reporter for Web Vitals (e.g., Sentry, custom endpoint).
 * Called once during app initialization.
 */
export function setVitalsReporter(reporter: VitalReporter): void {
  activeReporter = reporter
}

/**
 * Thresholds for rating Web Vitals (Google's recommendations).
 */
export const VITALS_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 }, // ms
  INP: { good: 200, poor: 500 }, // ms
  CLS: { good: 0.1, poor: 0.25 }, // score
  FCP: { good: 1800, poor: 3000 }, // ms
  TTFB: { good: 800, poor: 1800 }, // ms
} as const

/**
 * Rate a metric value against Google's thresholds.
 */
export function rateVital(
  name: keyof typeof VITALS_THRESHOLDS,
  value: number,
): 'good' | 'needs-improvement' | 'poor' {
  const threshold = VITALS_THRESHOLDS[name]
  if (value <= threshold.good) return 'good'
  if (value <= threshold.poor) return 'needs-improvement'
  return 'poor'
}

/**
 * Report a vital metric through the active reporter.
 */
function reportVital(metric: VitalMetric): void {
  activeReporter(metric)
}

function currentRoute(): string | undefined {
  try {
    return window.location.pathname
  } catch {
    return undefined
  }
}

/**
 * Observe an entry type when the platform supports it; returns whether the
 * observer was installed. Vitals are best-effort — an unsupported entry type
 * (or any observer error) must never break the app.
 */
function observeEntries(
  type: string,
  onEntries: (entries: PerformanceEntry[]) => void,
): boolean {
  try {
    const supported = PerformanceObserver.supportedEntryTypes
    if (supported && !supported.includes(type)) return false
    new PerformanceObserver((list) => onEntries(list.getEntries())).observe({
      type,
      buffered: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Initialize Core Web Vitals collection (LCP + CLS).
 * No-op outside the browser / without PerformanceObserver support.
 * Reports once, when the page goes hidden — the point where both metrics are
 * final (an LCP candidate can still be superseded while the page is visible,
 * and layout shifts accumulate until then).
 */
export function initWebVitals(): void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return
  }

  let lcpValue: number | null = null
  let clsValue = 0

  observeEntries('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1]
    if (last) lcpValue = last.startTime
  })

  const clsSupported = observeEntries('layout-shift', (entries) => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & {
        value?: number
        hadRecentInput?: boolean
      }
      // hadRecentInput shifts are user-initiated (e.g. toggles) — excluded per
      // the CLS definition.
      if (!shift.hadRecentInput) clsValue += shift.value ?? 0
    }
  })

  const flush = () => {
    const route = currentRoute()
    if (lcpValue !== null) {
      reportVital({
        name: 'LCP',
        value: lcpValue,
        rating: rateVital('LCP', lcpValue),
        route,
      })
    }
    if (clsSupported) {
      reportVital({
        name: 'CLS',
        value: clsValue,
        rating: rateVital('CLS', clsValue),
        route,
      })
    }
  }

  if (document.visibilityState === 'hidden') {
    flush()
    return
  }
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') flush()
    },
    { once: true },
  )
}
