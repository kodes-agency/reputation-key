import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  initWebVitals,
  rateVital,
  setVitalsReporter,
  VITALS_THRESHOLDS,
  type VitalMetric,
} from './web-vitals'

// Mock PerformanceObserver: records instances so tests can emit entries
// through the callback the module registered.
class MockPerformanceObserver {
  static supportedEntryTypes: string[] = ['largest-contentful-paint', 'layout-shift']
  static instances: MockPerformanceObserver[] = []

  observedType: string | undefined

  constructor(private readonly cb: (list: { getEntries(): unknown[] }) => void) {
    MockPerformanceObserver.instances.push(this)
  }

  observe(init: { type: string }) {
    this.observedType = init.type
  }

  emit(entries: unknown[]) {
    this.cb({ getEntries: () => entries })
  }

  disconnect() {}
}

function stubBrowserGlobals(input?: {
  supportedEntryTypes?: string[]
  visibilityState?: string
}) {
  MockPerformanceObserver.instances = []
  MockPerformanceObserver.supportedEntryTypes = input?.supportedEntryTypes ?? [
    'largest-contentful-paint',
    'layout-shift',
  ]
  const listeners = new Map<string, () => void>()
  const documentMock = {
    visibilityState: input?.visibilityState ?? 'visible',
    addEventListener: (type: string, handler: () => void) => {
      listeners.set(type, handler)
    },
  }
  vi.stubGlobal('PerformanceObserver', MockPerformanceObserver)
  vi.stubGlobal('document', documentMock)
  vi.stubGlobal('window', { location: { pathname: '/inbox' } })
  return {
    documentMock,
    /** Transition to hidden + fire the registered visibilitychange listener. */
    goHidden() {
      documentMock.visibilityState = 'hidden'
      listeners.get('visibilitychange')?.()
    },
    observerFor(type: string) {
      return MockPerformanceObserver.instances.find((i) => i.observedType === type)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('web-vitals (B2.7)', () => {
  describe('rateVital', () => {
    it('rates LCP as good when under 2500ms', () => {
      expect(rateVital('LCP', 2000)).toBe('good')
    })

    it('rates LCP as needs-improvement between 2500-4000ms', () => {
      expect(rateVital('LCP', 3000)).toBe('needs-improvement')
    })

    it('rates LCP as poor above 4000ms', () => {
      expect(rateVital('LCP', 5000)).toBe('poor')
    })

    it('rates INP as good when under 200ms', () => {
      expect(rateVital('INP', 150)).toBe('good')
    })

    it('rates INP as poor above 500ms', () => {
      expect(rateVital('INP', 600)).toBe('poor')
    })

    it('rates CLS as good when under 0.1', () => {
      expect(rateVital('CLS', 0.05)).toBe('good')
    })

    it('rates CLS as poor above 0.25', () => {
      expect(rateVital('CLS', 0.3)).toBe('poor')
    })
  })

  describe('VITALS_THRESHOLDS', () => {
    it('has thresholds for all core metrics', () => {
      expect(VITALS_THRESHOLDS.LCP).toBeDefined()
      expect(VITALS_THRESHOLDS.INP).toBeDefined()
      expect(VITALS_THRESHOLDS.CLS).toBeDefined()
      expect(VITALS_THRESHOLDS.FCP).toBeDefined()
      expect(VITALS_THRESHOLDS.TTFB).toBeDefined()
    })
  })

  describe('initWebVitals (BQC-6.8 wiring)', () => {
    it('is a no-op without browser globals (never throws on the server)', () => {
      expect(() => initWebVitals()).not.toThrow()
    })

    it('reports the last LCP candidate with rating + route on page hide', () => {
      const browser = stubBrowserGlobals()
      const reported: VitalMetric[] = []
      setVitalsReporter((m) => reported.push(m))

      initWebVitals()
      browser.observerFor('largest-contentful-paint')?.emit([{ startTime: 1200 }])
      browser
        .observerFor('largest-contentful-paint')
        ?.emit([{ startTime: 1200 }, { startTime: 1800 }])
      browser.goHidden()

      expect(reported).toContainEqual({
        name: 'LCP',
        value: 1800,
        rating: 'good',
        route: '/inbox',
      })
    })

    it('accumulates CLS excluding hadRecentInput shifts', () => {
      const browser = stubBrowserGlobals()
      const reported: VitalMetric[] = []
      setVitalsReporter((m) => reported.push(m))

      initWebVitals()
      browser.observerFor('layout-shift')?.emit([
        { value: 0.05, hadRecentInput: false },
        { value: 0.5, hadRecentInput: true }, // user-initiated — excluded
        { value: 0.02 }, // missing flag treated as not-user-initiated
      ])
      browser.goHidden()

      expect(reported).toContainEqual({
        name: 'CLS',
        value: 0.07,
        rating: 'good',
        route: '/inbox',
      })
    })

    it('reports nothing for unsupported entry types', () => {
      const browser = stubBrowserGlobals({ supportedEntryTypes: [] })
      const reported: VitalMetric[] = []
      setVitalsReporter((m) => reported.push(m))

      initWebVitals()
      expect(browser.observerFor('largest-contentful-paint')).toBeUndefined()
      expect(browser.observerFor('layout-shift')).toBeUndefined()
      browser.goHidden()

      expect(reported).toEqual([])
    })

    it('flushes immediately when the page is already hidden at init', () => {
      stubBrowserGlobals({ visibilityState: 'hidden' })
      const reported: VitalMetric[] = []
      setVitalsReporter((m) => reported.push(m))

      initWebVitals()

      // No LCP entry possible, but the supported CLS observer flushes its 0.
      expect(reported).toEqual([
        { name: 'CLS', value: 0, rating: 'good', route: '/inbox' },
      ])
    })
  })
})
