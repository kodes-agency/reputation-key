import { describe, it, expect } from 'vitest'
import {
  isValidConnectionTransition,
  assertValidConnectionTransition,
  canSync,
  isConnectionTerminal,
  isActionRequired,
} from './connection-lifecycle'

describe('connection-lifecycle (B1.6)', () => {
  describe('isValidConnectionTransition', () => {
    it('allows pending → active', () => {
      expect(isValidConnectionTransition('pending', 'active')).toBe(true)
    })

    it('allows pending → failed', () => {
      expect(isValidConnectionTransition('pending', 'failed')).toBe(true)
    })

    it('allows active → degraded', () => {
      expect(isValidConnectionTransition('active', 'degraded')).toBe(true)
    })

    it('allows active → reauth_required', () => {
      expect(isValidConnectionTransition('active', 'reauth_required')).toBe(true)
    })

    it('allows active → disconnecting', () => {
      expect(isValidConnectionTransition('active', 'disconnecting')).toBe(true)
    })

    it('allows degraded → active (recovery)', () => {
      expect(isValidConnectionTransition('degraded', 'active')).toBe(true)
    })

    it('allows reauth_required → active (after re-auth)', () => {
      expect(isValidConnectionTransition('reauth_required', 'active')).toBe(true)
    })

    it('allows disconnecting → disconnected', () => {
      expect(isValidConnectionTransition('disconnecting', 'disconnected')).toBe(true)
    })

    it('rejects disconnected → active (terminal)', () => {
      expect(isValidConnectionTransition('disconnected', 'active')).toBe(false)
    })

    it('rejects failed → active (terminal)', () => {
      expect(isValidConnectionTransition('failed', 'active')).toBe(false)
    })

    it('rejects pending → disconnected (must go through active first)', () => {
      expect(isValidConnectionTransition('pending', 'disconnected')).toBe(false)
    })

    it('rejects same-state transitions', () => {
      expect(isValidConnectionTransition('active', 'active')).toBe(false)
    })
  })

  describe('assertValidConnectionTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertValidConnectionTransition('pending', 'active')).not.toThrow()
    })

    it('throws for invalid transitions', () => {
      expect(() => assertValidConnectionTransition('disconnected', 'active')).toThrow()
    })
  })

  describe('canSync', () => {
    it('returns true for active', () => {
      expect(canSync('active')).toBe(true)
    })

    it('returns true for degraded', () => {
      expect(canSync('degraded')).toBe(true)
    })

    it('returns false for reauth_required', () => {
      expect(canSync('reauth_required')).toBe(false)
    })

    it('returns false for disconnected', () => {
      expect(canSync('disconnected')).toBe(false)
    })

    it('returns false for pending', () => {
      expect(canSync('pending')).toBe(false)
    })
  })

  describe('isConnectionTerminal', () => {
    it('returns true for disconnected', () => {
      expect(isConnectionTerminal('disconnected')).toBe(true)
    })

    it('returns true for failed', () => {
      expect(isConnectionTerminal('failed')).toBe(true)
    })

    it('returns false for active', () => {
      expect(isConnectionTerminal('active')).toBe(false)
    })

    it('returns false for reauth_required', () => {
      expect(isConnectionTerminal('reauth_required')).toBe(false)
    })
  })

  describe('isActionRequired', () => {
    it('returns true for reauth_required', () => {
      expect(isActionRequired('reauth_required')).toBe(true)
    })

    it('returns true for failed', () => {
      expect(isActionRequired('failed')).toBe(true)
    })

    it('returns false for active', () => {
      expect(isActionRequired('active')).toBe(false)
    })

    it('returns false for degraded', () => {
      expect(isActionRequired('degraded')).toBe(false)
    })
  })
})
