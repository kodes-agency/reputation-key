import { describe, it, expect } from 'vitest'
import {
  isValidTransition,
  assertValidTransition,
  assertCanPerformExternalEffect,
  isRecoverable,
  isTerminal,
  isBlocked,
  initialState,
  stateWeight,
} from './property-lifecycle'

describe('property-lifecycle (B1.5)', () => {
  describe('isValidTransition', () => {
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

    it('rejects active → archived (must suspend first)', () => {
      expect(isValidTransition('active', 'archived')).toBe(false)
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

  describe('assertCanPerformExternalEffect', () => {
    it('does not throw for active', () => {
      expect(() => assertCanPerformExternalEffect('active')).not.toThrow()
    })

    it('throws tagged PropertyError for suspended (BQR-1.2)', () => {
      try {
        assertCanPerformExternalEffect('suspended')
        expect.fail('expected throw')
      } catch (e) {
        expect(e).toMatchObject({
          _tag: 'PropertyError',
          code: 'property_not_active',
        })
      }
    })

    it('throws for archived', () => {
      expect(() => assertCanPerformExternalEffect('archived')).toThrow()
    })

    it('throws for purged', () => {
      expect(() => assertCanPerformExternalEffect('purged')).toThrow()
    })
  })

  describe('isRecoverable', () => {
    it('returns true for suspended', () => {
      expect(isRecoverable('suspended')).toBe(true)
    })

    it('returns true for archived', () => {
      expect(isRecoverable('archived')).toBe(true)
    })

    it('returns true for purge_pending', () => {
      expect(isRecoverable('purge_pending')).toBe(true)
    })

    it('returns false for purging', () => {
      expect(isRecoverable('purging')).toBe(false)
    })

    it('returns false for purged', () => {
      expect(isRecoverable('purged')).toBe(false)
    })

    it('returns false for active', () => {
      expect(isRecoverable('active')).toBe(false)
    })
  })

  describe('isTerminal', () => {
    it('returns true for purged', () => {
      expect(isTerminal('purged')).toBe(true)
    })

    it('returns false for active', () => {
      expect(isTerminal('active')).toBe(false)
    })

    it('returns false for purge_pending', () => {
      expect(isTerminal('purge_pending')).toBe(false)
    })
  })

  describe('isBlocked', () => {
    it('returns false for active', () => {
      expect(isBlocked('active')).toBe(false)
    })

    it('returns true for suspended', () => {
      expect(isBlocked('suspended')).toBe(true)
    })

    it('returns true for archived', () => {
      expect(isBlocked('archived')).toBe(true)
    })

    it('returns true for purged', () => {
      expect(isBlocked('purged')).toBe(true)
    })
  })

  describe('initialState', () => {
    it('returns active', () => {
      expect(initialState()).toBe('active')
    })
  })

  describe('stateWeight', () => {
    it('orders states from active to purged', () => {
      expect(stateWeight('active')).toBeLessThan(stateWeight('suspended'))
      expect(stateWeight('suspended')).toBeLessThan(stateWeight('archived'))
      expect(stateWeight('archived')).toBeLessThan(stateWeight('disconnecting'))
      expect(stateWeight('disconnecting')).toBeLessThan(stateWeight('purge_pending'))
      expect(stateWeight('purge_pending')).toBeLessThan(stateWeight('purging'))
      expect(stateWeight('purging')).toBeLessThan(stateWeight('purged'))
    })
  })
})
