import { describe, it, expect } from 'vitest'
import {
  PROJECTION_CONTRACTS,
  isProjectionStale,
  getFreshnessLabel,
  shouldApplyEvent,
} from './projection-contract'
const NOW = new Date('2026-07-14T12:00:00Z')

describe('projection-contract (B1.11)', () => {
  describe('PROJECTION_CONTRACTS', () => {
    it('all projections are idempotent (replay-safe)', () => {
      for (const [name, contract] of Object.entries(PROJECTION_CONTRACTS)) {
        expect(contract.idempotent, `${name} should be idempotent`).toBe(true)
      }
    })

    it('all projections are rebuildable', () => {
      for (const [name, contract] of Object.entries(PROJECTION_CONTRACTS)) {
        expect(contract.rebuildable, `${name} should be rebuildable`).toBe(true)
      }
    })

    it('all projections declare source events', () => {
      for (const [name, contract] of Object.entries(PROJECTION_CONTRACTS)) {
        expect(
          contract.sourceEvents.length,
          `${name} should have source events`,
        ).toBeGreaterThan(0)
      }
    })

    it('all projections have a max staleness', () => {
      for (const [name, contract] of Object.entries(PROJECTION_CONTRACTS)) {
        expect(
          contract.maxStalenessMs,
          `${name} should have max staleness`,
        ).toBeGreaterThan(0)
      }
    })
  })

  describe('isProjectionStale', () => {
    it('returns false when within staleness window', () => {
      const updatedAt = new Date(NOW.getTime() - 10_000) // 10s ago
      expect(isProjectionStale('inbox', updatedAt, NOW)).toBe(false)
    })

    it('returns true when exceeding staleness window', () => {
      const updatedAt = new Date(NOW.getTime() - 60_000) // 60s ago
      expect(isProjectionStale('inbox', updatedAt, NOW)).toBe(true)
    })

    it('uses per-context staleness budget', () => {
      const updatedAt = new Date(NOW.getTime() - 120_000) // 2min ago
      expect(isProjectionStale('inbox', updatedAt, NOW)).toBe(true) // 30s budget
      expect(isProjectionStale('metric', updatedAt, NOW)).toBe(false) // 5min budget
    })
  })

  describe('getFreshnessLabel', () => {
    it('returns fresh when within budget', () => {
      const updatedAt = new Date(NOW.getTime() - 5_000)
      expect(getFreshnessLabel('inbox', updatedAt, NOW)).toBe('fresh')
    })

    it('returns stale when slightly over budget', () => {
      const updatedAt = new Date(NOW.getTime() - 40_000) // 40s, inbox budget 30s
      expect(getFreshnessLabel('inbox', updatedAt, NOW)).toBe('stale')
    })

    it('returns degraded when well over budget', () => {
      const updatedAt = new Date(NOW.getTime() - 120_000) // 2min, inbox budget 30s
      expect(getFreshnessLabel('inbox', updatedAt, NOW)).toBe('degraded')
    })

    it('returns unknown when lastUpdatedAt is null', () => {
      expect(getFreshnessLabel('inbox', null, NOW)).toBe('unknown')
    })
  })

  describe('shouldApplyEvent', () => {
    it('returns true for first event (null last version)', () => {
      expect(shouldApplyEvent(1, null)).toBe(true)
    })

    it('returns true when event version is higher', () => {
      expect(shouldApplyEvent(5, 3)).toBe(true)
    })

    it('returns false when event version is lower (out of order)', () => {
      expect(shouldApplyEvent(2, 5)).toBe(false)
    })

    it('returns false when event version is equal (duplicate)', () => {
      expect(shouldApplyEvent(5, 5)).toBe(false)
    })
  })
})
