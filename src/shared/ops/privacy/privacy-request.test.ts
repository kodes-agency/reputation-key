import { describe, expect, it } from 'vitest'
import {
  PRIVACY_REFUSAL_REASON_CODES,
  PRIVACY_REQUEST_STATES,
  assertContentFreePrivacySubject,
  assertValidPrivacyRequestTransition,
  isPrivacyRequestTerminal,
  isValidPrivacyRequestTransition,
  type PrivacyRequestState,
} from './privacy-request'
import { PRIVACY_REQUEST_STATES as SCHEMA_STATES } from '#/shared/db/schema/privacy-request.schema'

const SUBJECT = 'a'.repeat(64)

describe('privacy request state machine (LIF-01-T20)', () => {
  it('matches the states the database enumerates', () => {
    expect([...PRIVACY_REQUEST_STATES]).toEqual([...SCHEMA_STATES])
  })

  it('walks received -> verified -> in_progress -> fulfilled', () => {
    expect(isValidPrivacyRequestTransition('received', 'verified')).toBe(true)
    expect(isValidPrivacyRequestTransition('verified', 'in_progress')).toBe(true)
    expect(isValidPrivacyRequestTransition('in_progress', 'fulfilled')).toBe(true)
    for (const from of PRIVACY_REQUEST_STATES) {
      expect(isValidPrivacyRequestTransition(from, 'refused')).toBe(
        !isPrivacyRequestTerminal(from),
      )
    }
  })

  it('lets NO edge skip identity verification', () => {
    // Acting on an unverified request is how one person reads or erases
    // another person's data.
    for (const to of ['in_progress', 'fulfilled'] as const) {
      expect(isValidPrivacyRequestTransition('received', to)).toBe(false)
      expect(() => assertValidPrivacyRequestTransition('received', to)).toThrow(
        /before the subject identity is verified/u,
      )
      try {
        assertValidPrivacyRequestTransition('received', to)
      } catch (error) {
        expect(error).toMatchObject({
          _tag: 'PrivacyRequestError',
          code: 'identity_not_verified',
        })
      }
    }
  })

  it('allows nothing out of a terminal state', () => {
    for (const terminal of ['fulfilled', 'refused'] as const) {
      for (const to of PRIVACY_REQUEST_STATES as readonly PrivacyRequestState[]) {
        expect(isValidPrivacyRequestTransition(terminal, to)).toBe(false)
      }
    }
  })

  it('requires an explicit refusal reason code', () => {
    expect(() => assertValidPrivacyRequestTransition('verified', 'refused')).toThrow(
      /explicit reason code/u,
    )
    for (const code of PRIVACY_REFUSAL_REASON_CODES) {
      expect(() =>
        assertValidPrivacyRequestTransition('verified', 'refused', code),
      ).not.toThrow()
      // Reason codes are countable and content-free by construction.
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/u)
    }
  })

  it('carries no free-text subject content in any state', () => {
    expect(() => assertContentFreePrivacySubject(SUBJECT)).not.toThrow()
    expect(() => assertContentFreePrivacySubject('guest@example.com')).toThrow(
      /never the identifier itself/u,
    )
    expect(() =>
      assertContentFreePrivacySubject(SUBJECT, 'the room smelled of smoke'),
    ).toThrow(/names a schema field, never a value/u)
    expect(() =>
      assertContentFreePrivacySubject(SUBJECT, 'private_feedback_body'),
    ).not.toThrow()
  })
})
