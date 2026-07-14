// Inbox context — domain rules tests (ADR 0023: open/closed 2-state machine)

import { describe, it, expect } from 'vitest'
import { canTransition, validateTransition, canAssign, validateAssignment } from './rules'
import { isInboxError } from './errors'
import type { InboxStatus } from './types'

// ─── canTransition ──────────────────────────────────────────────────

describe('canTransition', () => {
  const ALL_STATUSES: InboxStatus[] = ['open', 'closed']

  // Valid transitions — the only two edges in the 2-state machine (ADR 0023)
  describe('valid transitions', () => {
    const validCases: ReadonlyArray<[InboxStatus, InboxStatus]> = [
      ['open', 'closed'],
      ['closed', 'open'],
    ]

    it.each(validCases)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true)
    })
  })

  // Same-status transitions (never valid)
  describe('same-status transitions', () => {
    const sameCases: ReadonlyArray<[InboxStatus, InboxStatus]> = ALL_STATUSES.map(
      (s) => [s, s] as [InboxStatus, InboxStatus],
    )

    it.each(sameCases)('rejects %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false)
    })
  })
})

// ─── validateTransition ─────────────────────────────────────────────

describe('validateTransition', () => {
  it('returns ok with the target status for a valid transition', () => {
    const result = validateTransition('open', 'closed')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe('closed')
  })

  it('returns ok for closed → open transition', () => {
    const result = validateTransition('closed', 'open')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe('open')
  })

  it('returns err with invalid_transition code for an invalid transition', () => {
    const result = validateTransition('open', 'open')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('invalid_transition')
    expect(error.message).toContain('open')
    expect(error.message).toContain('open')
  })

  it('returns err for same-status transition', () => {
    const result = validateTransition('closed', 'closed')
    expect(result.isErr()).toBe(true)
  })

  it('error is recognised by isInboxError', () => {
    const result = validateTransition('open', 'open')
    expect(result.isErr()).toBe(true)
    expect(isInboxError(result._unsafeUnwrapErr())).toBe(true)
  })
})

// ─── canAssign ───────────────────────────────────────────────────────

describe('canAssign', () => {
  it('returns true for roles with inbox.manage (AccountAdmin)', () => {
    expect(canAssign('AccountAdmin')).toBe(true)
  })

  it('returns true for PropertyManager', () => {
    expect(canAssign('PropertyManager')).toBe(true)
  })

  it('returns false for Staff', () => {
    expect(canAssign('Staff')).toBe(false)
  })
})

// ─── validateAssignment ─────────────────────────────────────────────

describe('validateAssignment', () => {
  it('returns ok for roles with inbox.manage', () => {
    expect(validateAssignment('AccountAdmin').isOk()).toBe(true)
    expect(validateAssignment('PropertyManager').isOk()).toBe(true)
  })

  it('returns err with assignment_not_allowed for Staff', () => {
    const result = validateAssignment('Staff')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('assignment_not_allowed')
    expect(error.message).toContain('Staff')
  })
})
