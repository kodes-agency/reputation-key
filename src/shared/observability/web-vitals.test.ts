import { describe, it, expect } from 'vitest'
import { rateVital, VITALS_THRESHOLDS } from './web-vitals'

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
})
