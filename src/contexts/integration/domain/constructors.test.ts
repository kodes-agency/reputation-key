// Integration context — domain constructors tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import { buildGoogleConnection } from './constructors'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
const now = new Date('2025-06-01T00:00:00Z')

// ── buildGoogleConnection ──────────────────────────────────────────

describe('buildGoogleConnection', () => {
  const base = {
    id: googleConnectionId('conn-1'),
    organizationId: organizationId('org-1'),
    identity: {
      kind: 'oidc' as const,
      googleSubject: 'signed-subject-123',
    },
    encryptedAccessToken: 'enc-at',
    encryptedRefreshToken: 'enc-rt',
    tokenExpiresAt: new Date('2025-12-01T00:00:00Z'),
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    connectedBy: userId('user-1'),
    now,
  }

  it('builds a connection with visibility "private"', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'private' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.id).toBe(base.id)
      expect(result.value.organizationId).toBe(base.organizationId)
      expect(result.value.googleSubject).toBe('signed-subject-123')
      expect(result.value.encryptedAccessToken).toBe('enc-at')
      expect(result.value.encryptedRefreshToken).toBe('enc-rt')
      expect(result.value.scopes).toEqual([
        'https://www.googleapis.com/auth/business.manage',
      ])
      expect(result.value.connectedBy).toBe(base.connectedBy)
      expect(result.value.visibility).toBe('private')
      expect(result.value.status).toBe('active')
      expect(result.value.createdAt).toBe(now)
      expect(result.value.updatedAt).toBe(now)
    }
  })

  it('builds a connection with visibility "organization"', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'organization' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.visibility).toBe('organization')
    }
  })

  it('sets status to "active"', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'private' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('active')
    }
  })

  it('sets createdAt and updatedAt to now', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'private' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.createdAt).toBe(now)
      expect(result.value.updatedAt).toBe(now)
    }
  })

  it('rejects an empty signed subject with oauth_failed code', () => {
    const result = buildGoogleConnection({
      ...base,
      visibility: 'private',
      identity: { kind: 'oidc', googleSubject: '' },
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('oauth_failed')
    }
  })

  it('rejects invalid visibility with invalid_visibility code', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'public' as 'private' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_visibility')
    }
  })

  it('propagates tokenExpiresAt from input', () => {
    const result = buildGoogleConnection({ ...base, visibility: 'private' })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.tokenExpiresAt).toBe(base.tokenExpiresAt)
    }
  })
})
