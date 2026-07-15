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
      const ids = new Set(Array.from({ length: 1000 }, () => generateCorrelationId()))
      expect(ids.size).toBe(1000)
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
