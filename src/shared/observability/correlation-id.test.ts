import { describe, it, expect } from 'vitest'
import {
  generateCorrelationId,
  formatCorrelationId,
  newDisplayCorrelationId,
} from './correlation-id'

describe('correlation-id (B2.6)', () => {
  describe('generateCorrelationId', () => {
    it('returns an 8-char hex string', () => {
      const id = generateCorrelationId()
      expect(id).toMatch(/^[a-f0-9]{8}$/)
    })

    it('generates unique IDs', () => {
      // An ID is 32 random bits, short enough to read out as REF-XXXXXXXX. A
      // thousand of them repeat about once in 8,600 runs, which CI hit on
      // 2026-11-21; a hundred repeat about once in 860,000.
      const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('formatCorrelationId', () => {
    it('formats with REF- prefix and uppercase', () => {
      expect(formatCorrelationId('a3f2b1c9')).toBe('REF-A3F2B1C9')
    })
  })

  describe('newDisplayCorrelationId', () => {
    it('returns a formatted correlation ID', () => {
      const id = newDisplayCorrelationId()
      expect(id).toMatch(/^REF-[A-F0-9]{8}$/)
    })
  })
})
