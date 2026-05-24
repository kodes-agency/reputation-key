// Integration context — domain constructors tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import {
  buildGoogleConnection,
  buildGbpImportJob,
  createGbpCacheEntry,
} from './constructors'
import {
  googleConnectionId,
  gbpImportJobId,
  gbpCacheEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
const now = new Date('2025-06-01T00:00:00Z')

// ── buildGoogleConnection ──────────────────────────────────────────

describe('buildGoogleConnection', () => {
  const base = {
    id: googleConnectionId('conn-1'),
    organizationId: organizationId('org-1'),
    googleAccountId: 'account-123',
    googleEmail: 'user@example.com',
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
      expect(result.value.googleAccountId).toBe('account-123')
      expect(result.value.googleEmail).toBe('user@example.com')
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

  it('rejects email without @ with oauth_failed code', () => {
    const result = buildGoogleConnection({
      ...base,
      visibility: 'private',
      googleEmail: 'no-at-symbol',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('oauth_failed')
    }
  })

  it('rejects empty email with oauth_failed code', () => {
    const result = buildGoogleConnection({
      ...base,
      visibility: 'private',
      googleEmail: '',
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

// ── buildGbpImportJob ──────────────────────────────────────────────

describe('buildGbpImportJob', () => {
  it('builds a job with all fields propagated', () => {
    const result = buildGbpImportJob({
      id: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      initiatedBy: userId('user-1'),
      totalCount: 50,
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.id).toBe(gbpImportJobId('job-1'))
      expect(result.value.organizationId).toBe(organizationId('org-1'))
      expect(result.value.initiatedBy).toBe(userId('user-1'))
      expect(result.value.totalCount).toBe(50)
    }
  })

  it('defaults status to "queued"', () => {
    const result = buildGbpImportJob({
      id: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      initiatedBy: userId('user-1'),
      totalCount: 10,
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('queued')
    }
  })

  it('defaults counters to 0', () => {
    const result = buildGbpImportJob({
      id: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      initiatedBy: userId('user-1'),
      totalCount: 10,
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.importedCount).toBe(0)
      expect(result.value.skippedCount).toBe(0)
      expect(result.value.failedCount).toBe(0)
    }
  })

  it('sets createdAt and updatedAt to now', () => {
    const result = buildGbpImportJob({
      id: gbpImportJobId('job-1'),
      organizationId: organizationId('org-1'),
      initiatedBy: userId('user-1'),
      totalCount: 10,
      now,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.createdAt).toBe(now)
      expect(result.value.updatedAt).toBe(now)
    }
  })
})

// ── createGbpCacheEntry ──────────────────────────────────────────────

describe('createGbpCacheEntry', () => {
  const fetchedAt = new Date('2025-06-01T12:00:00Z')
  const expiresAt = new Date('2025-06-02T12:00:00Z')

  const base = {
    id: gbpCacheEntryId('cache-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    dataType: 'location' as const,
    payload: { name: 'Test Business' },
    googleAttribution: 'Attributed to Google',
    fetchedAt,
    expiresAt,
    updatedAt: fetchedAt,
  }

  it('creates a valid cache entry', () => {
    const result = createGbpCacheEntry(base)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.id).toBe(base.id)
      expect(result.value.organizationId).toBe(base.organizationId)
      expect(result.value.propertyId).toBe(base.propertyId)
      expect(result.value.gbpPlaceId).toBe(base.gbpPlaceId)
      expect(result.value.dataType).toBe('location')
      expect(result.value.payload).toEqual({ name: 'Test Business' })
      expect(result.value.googleAttribution).toBe('Attributed to Google')
      expect(result.value.fetchedAt).toBe(fetchedAt)
      expect(result.value.expiresAt).toBe(expiresAt)
    }
  })

  it('accepts null googleAttribution', () => {
    const result = createGbpCacheEntry({ ...base, googleAttribution: null })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.googleAttribution).toBeNull()
    }
  })

  it('rejects when expiresAt is before fetchedAt', () => {
    const result = createGbpCacheEntry({
      ...base,
      expiresAt: new Date('2025-05-30T12:00:00Z'),
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_cache_entry')
      expect(result.error.message).toContain('expiresAt must be after fetchedAt')
    }
  })

  it('rejects when expiresAt equals fetchedAt', () => {
    const result = createGbpCacheEntry({
      ...base,
      expiresAt: fetchedAt,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_cache_entry')
    }
  })

  it('rejects when gbpPlaceId is empty', () => {
    const result = createGbpCacheEntry({ ...base, gbpPlaceId: '' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_cache_entry')
    }
  })
})
