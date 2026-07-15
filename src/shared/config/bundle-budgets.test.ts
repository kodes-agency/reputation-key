import { describe, it, expect } from 'vitest'
import {
  BUNDLE_BUDGETS,
  formatKB,
  isWithinBudget,
  buildBudgetReport,
  type ChunkMeasurement,
} from './bundle-budgets'

describe('bundle-budgets (B2.7)', () => {
  describe('formatKB', () => {
    it('formats bytes as KB', () => {
      expect(formatKB(1024)).toBe('1.0 KB')
      expect(formatKB(1536)).toBe('1.5 KB')
      expect(formatKB(0)).toBe('0.0 KB')
    })
  })

  describe('isWithinBudget', () => {
    it('returns true when under budget', () => {
      expect(isWithinBudget('root', 150_000)).toBe(true) // 150KB < 200KB
    })

    it('returns false when over budget', () => {
      expect(isWithinBudget('root', 250_000)).toBe(false) // 250KB > 200KB
    })
  })

  describe('buildBudgetReport', () => {
    it('maps chunks to budgets', () => {
      const chunks: ChunkMeasurement[] = [
        { name: 'vendor-charts', sizeBytes: 100_000, gzippedBytes: 80_000 },
        { name: 'vendor-dnd', sizeBytes: 50_000, gzippedBytes: 40_000 },
      ]
      const report = buildBudgetReport(chunks)

      expect(report.chunks).toHaveLength(2)
      expect(report.chunks[0].budgetKB).toBe(150) // vendorCharts budget
      expect(report.chunks[0].withinBudget).toBe(true) // 80KB < 150KB
      expect(report.totalGzipped).toBe(120_000)
      expect(report.regressions).toBe(0)
    })

    it('counts regressions', () => {
      const chunks: ChunkMeasurement[] = [
        { name: 'vendor-charts', sizeBytes: 200_000, gzippedBytes: 180_000 }, // over 150KB
      ]
      const report = buildBudgetReport(chunks)
      expect(report.regressions).toBe(1)
    })

    it('handles unknown chunks without budget', () => {
      const chunks: ChunkMeasurement[] = [
        { name: 'unknown-chunk', sizeBytes: 500_000, gzippedBytes: 400_000 },
      ]
      const report = buildBudgetReport(chunks)
      expect(report.chunks[0].budgetKB).toBeUndefined()
      expect(report.chunks[0].withinBudget).toBe(true) // no budget = always "within"
      expect(report.regressions).toBe(0)
    })
  })

  describe('BUNDLE_BUDGETS', () => {
    it('has budgets for all critical chunks', () => {
      expect(BUNDLE_BUDGETS.root).toBeGreaterThan(0)
      expect(BUNDLE_BUDGETS.inbox).toBeGreaterThan(0)
      expect(BUNDLE_BUDGETS.dashboard).toBeGreaterThan(0)
      expect(BUNDLE_BUDGETS.initialTotal).toBeGreaterThan(0)
    })
  })
})
