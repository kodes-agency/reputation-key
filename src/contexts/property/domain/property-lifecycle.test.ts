import { describe, it, expect } from 'vitest'
import {
  type PropertyLifecycleState,
  PROPERTY_ARCHIVE_RECOVERY_WINDOW_MS,
  archiveRecoveryDeadline,
  assertValidTransition,
} from './property-lifecycle'

const isValidTransition = (from: PropertyLifecycleState, to: PropertyLifecycleState) => {
  try {
    assertValidTransition(from, to)
    return true
  } catch {
    return false
  }
}

describe('property-lifecycle (B1.5)', () => {
  describe('isValidTransition', () => {
    it('allows active → archived for ordinary recoverable removal', () => {
      expect(isValidTransition('active', 'archived')).toBe(true)
    })

    it('allows active → suspended', () => {
      expect(isValidTransition('active', 'suspended')).toBe(true)
    })

    it('allows suspended → active (recovery)', () => {
      expect(isValidTransition('suspended', 'active')).toBe(true)
    })

    it('allows suspended → archived', () => {
      expect(isValidTransition('suspended', 'archived')).toBe(true)
    })

    it('allows archived → active (recovery)', () => {
      expect(isValidTransition('archived', 'active')).toBe(true)
    })

    it('allows archived → disconnecting', () => {
      expect(isValidTransition('archived', 'disconnecting')).toBe(true)
    })

    it('allows disconnecting → purge_pending', () => {
      expect(isValidTransition('disconnecting', 'purge_pending')).toBe(true)
    })

    it('allows purge_pending → purging (irreversible boundary)', () => {
      expect(isValidTransition('purge_pending', 'purging')).toBe(true)
    })

    it('allows purge_pending → archived (recovery during grace period)', () => {
      expect(isValidTransition('purge_pending', 'archived')).toBe(true)
    })

    it('allows purging → purged (terminal)', () => {
      expect(isValidTransition('purging', 'purged')).toBe(true)
    })

    it('rejects active → purged (cannot skip states)', () => {
      expect(isValidTransition('active', 'purged')).toBe(false)
    })

    it('rejects purged → active (terminal, no recovery)', () => {
      expect(isValidTransition('purged', 'active')).toBe(false)
    })

    it('rejects purging → active (no recovery after purge starts)', () => {
      expect(isValidTransition('purging', 'active')).toBe(false)
    })

    it('rejects same-state transitions', () => {
      expect(isValidTransition('active', 'active')).toBe(false)
      expect(isValidTransition('archived', 'archived')).toBe(false)
    })
  })

  describe('archiveRecoveryDeadline', () => {
    it('opens the documented 30-day self-service recovery window', () => {
      const archivedAt = new Date('2026-08-28T12:00:00.000Z')

      expect(archiveRecoveryDeadline(archivedAt)).toEqual(
        new Date(archivedAt.getTime() + PROPERTY_ARCHIVE_RECOVERY_WINDOW_MS),
      )
      expect(PROPERTY_ARCHIVE_RECOVERY_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1_000)
    })
  })

  describe('assertValidTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertValidTransition('active', 'suspended')).not.toThrow()
    })

    it('throws tagged PropertyError for invalid transitions (BQR-1.2)', () => {
      try {
        assertValidTransition('active', 'purged')
        expect.fail('expected throw')
      } catch (e) {
        expect(e).toMatchObject({
          _tag: 'PropertyError',
          code: 'invalid_transition',
        })
      }
    })
  })
})
