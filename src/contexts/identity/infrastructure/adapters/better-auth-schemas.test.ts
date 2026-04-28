// Unit tests for better-auth response schemas and parse helper.

import { describe, it, expect } from 'vitest'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
  betterAuthInvitationSchema,
} from './better-auth-schemas'

describe('parseBetterAuthResponse', () => {
  it('returns parsed data on valid input', () => {
    const raw = { token: 'abc', user: { id: 'u-1' } }
    const result = parseBetterAuthResponse(
      signUpResponseSchema,
      raw,
      'registration_failed',
      'bad',
    )
    expect(result.user.id).toBe('u-1')
  })

  it('throws IdentityError on schema mismatch', () => {
    expect(() =>
      parseBetterAuthResponse(
        signUpResponseSchema,
        {},
        'registration_failed',
        'Sign-up response invalid',
      ),
    ).toThrow('Sign-up response invalid')
  })

  it('includes _tag and code in thrown error', () => {
    try {
      parseBetterAuthResponse(signUpResponseSchema, null, 'registration_failed', 'fail')
      expect.fail('should have thrown')
    } catch (e) {
      expect(typeof e === 'object' && e !== null && (e as { _tag?: string })._tag).toBe(
        'IdentityError',
      )
      expect(typeof e === 'object' && e !== null && (e as { code?: string }).code).toBe(
        'registration_failed',
      )
    }
  })

  it('parses listMembers response with nested users', () => {
    const raw = {
      members: [
        {
          id: 'm-1',
          userId: 'u-1',
          role: 'owner',
          createdAt: new Date('2026-01-01'),
          user: { id: 'u-1', email: 'a@t.com', name: 'A', image: null },
        },
      ],
      total: 1,
    }
    const result = parseBetterAuthResponse(
      listMembersResponseSchema,
      raw,
      'org_setup_failed',
      'bad',
    )
    expect(result.members).toHaveLength(1)
    expect(result.members[0].user.email).toBe('a@t.com')
  })

  it('coerces ISO date strings to Date objects', () => {
    const raw = {
      id: 'inv-1',
      email: 'a@t.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const result = parseBetterAuthResponse(
      betterAuthInvitationSchema,
      raw,
      'org_setup_failed',
      'bad',
    )
    expect(result.expiresAt instanceof Date).toBe(true)
    expect(result.createdAt instanceof Date).toBe(true)
  })

  it('accepts optional organization and propertyIds fields', () => {
    const raw = {
      id: 'inv-1',
      email: 'a@t.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(),
      createdAt: new Date(),
      organizationId: 'org-1',
      organization: { name: 'Test Org' },
      propertyIds: '["prop-1"]',
    }
    const result = parseBetterAuthResponse(
      betterAuthInvitationSchema,
      raw,
      'org_setup_failed',
      'bad',
    )
    expect(result.organization?.name).toBe('Test Org')
    expect(result.propertyIds).toBe('["prop-1"]')
  })
})
