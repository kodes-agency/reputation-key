// Inbox context — domain rules tests

import { describe, it, expect } from 'vitest'
import { canTransition, validateTransition, canAssign, validateAssignment } from './rules'
import { isInboxError } from './errors'
import type { InboxStatus } from './types'

// ─── canTransition ──────────────────────────────────────────────────

describe('canTransition', () => {
  const ALL_STATUSES: InboxStatus[] = [
    'new',
    'read',
    'addressed',
    'escalated',
    'archived',
  ]

  // Valid transitions
  describe('valid transitions', () => {
    const validCases: Array<[InboxStatus, InboxStatus]> = [
      ['new', 'read'],
      ['new', 'archived'],
      ['new', 'escalated'],
      ['read', 'addressed'],
      ['read', 'escalated'],
      ['escalated', 'addressed'],
      ['escalated', 'archived'],
      ['addressed', 'archived'],
    ]

    it.each(validCases)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true)
    })
  })

  // Same-status transitions (never valid)
  describe('same-status transitions', () => {
    it.each(ALL_STATUSES.map((s): [InboxStatus, InboxStatus] => [s, s]))(
      'rejects %s → %s (same status)',
      (from, to) => {
        expect(canTransition(from, to)).toBe(false)
      },
    )
  })

  // All impossible combos
  describe('invalid transitions', () => {
    const invalidCases: Array<[InboxStatus, InboxStatus]> = [
      // new cannot go to new, addressed
      ['new', 'new'],
      ['new', 'addressed'],
      // read cannot go to new, read, archived
      ['read', 'new'],
      ['read', 'read'],
      ['read', 'archived'],
      // escalated cannot go to new, read, escalated
      ['escalated', 'new'],
      ['escalated', 'read'],
      ['escalated', 'escalated'],
      // addressed cannot go to new, read, escalated, addressed
      ['addressed', 'new'],
      ['addressed', 'read'],
      ['addressed', 'escalated'],
      ['addressed', 'addressed'],
      // archived cannot go to anything — terminal state
      ['archived', 'new'],
      ['archived', 'read'],
      ['archived', 'archived'],
      ['archived', 'escalated'],
      ['archived', 'addressed'],
    ]

    it.each(invalidCases)('rejects %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false)
    })
  })
})

// ─── validateTransition ─────────────────────────────────────────────

describe('validateTransition', () => {
  it('returns ok with the target status for a valid transition', () => {
    const result = validateTransition('new', 'read')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe('read')
  })

  it('returns err with invalid_transition code for an invalid transition', () => {
    const result = validateTransition('new', 'addressed')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('invalid_transition')
    expect(error.message).toContain('new')
    expect(error.message).toContain('addressed')
    expect(error.context).toEqual({ from: 'new', to: 'addressed' })
  })

  it('returns err for same-status transition', () => {
    const result = validateTransition('read', 'read')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().code).toBe('invalid_transition')
  })

  it('error is recognised by isInboxError', () => {
    const result = validateTransition('archived', 'new')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(isInboxError(error)).toBe(true)
  })
})

// ─── canAssign ───────────────────────────────────────────────────────

describe('canAssign', () => {
  it('returns true for PropertyManager', () => {
    expect(canAssign('PropertyManager')).toBe(true)
  })

  it('returns true for AccountAdmin', () => {
    expect(canAssign('AccountAdmin')).toBe(true)
  })

  it('returns false for Staff', () => {
    expect(canAssign('Staff')).toBe(false)
  })

  it('returns false for unknown roles', () => {
    expect(canAssign('Guest')).toBe(false)
    expect(canAssign('')).toBe(false)
  })
})

// ─── validateAssignment ─────────────────────────────────────────────

describe('validateAssignment', () => {
  it('returns ok for PropertyManager', () => {
    const result = validateAssignment('PropertyManager')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(true)
  })

  it('returns ok for AccountAdmin', () => {
    const result = validateAssignment('AccountAdmin')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe(true)
  })

  it('returns err with assignment_not_allowed for Staff', () => {
    const result = validateAssignment('Staff')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('assignment_not_allowed')
    expect(error.message).toContain('Staff')
    expect(error.context).toEqual({ role: 'Staff' })
  })

  it('error is recognised by isInboxError', () => {
    const result = validateAssignment('Staff')
    expect(result.isErr()).toBe(true)
    expect(isInboxError(result._unsafeUnwrapErr())).toBe(true)
  })
})
