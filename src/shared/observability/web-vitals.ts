// BETA-2 B2.7: Core Web Vitals instrumentation stubs.
//
// Provides privacy-safe performance measurement hooks.
// In production, these would send to Sentry, Google Analytics, or a
// Web Vitals collector. The stubs ensure no PII is transmitted.
//
// Usage:
//   import { initWebVitals } from '#/components/hooks/web-vitals'
//   initWebVitals()  // call once in root layout

type VitalMetric = {
  name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  // Only privacy-safe dimensions — no user IDs, review content, etc.
  route?: string
}

type VitalReporter = (metric: VitalMetric) => void

// Default reporter: logs to console in dev, no-ops in production
// until a real collector (Sentry, etc.) is wired in BETA-3.
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
 * Initialize Core Web Vitals collection.
 * Uses the web-vitals library pattern but is currently a stub that
 * will be wired to onCLS/onINP/onLCP in BETA-3 when Sentry is active.
 */
export function initWebVitals(): void {
  // BETA-3 will wire actual web-vitals library here:
  // onLCP(reportLCP)
  // onINP(reportINP)
  // onCLS(reportCLS)
  //
  // For now, the infrastructure is in place — the reporter interface
  // ensures no PII dimensions are added later.
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
export function reportVital(metric: VitalMetric): void {
  activeReporter(metric)
}
