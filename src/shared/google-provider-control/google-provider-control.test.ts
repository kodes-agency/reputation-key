import { describe, expect, it } from 'vitest'
import { createInMemoryGoogleQuotaCoordinator } from './quota-coordinator.test-fixtures'
import { googleRetryDelayMs, parseGoogleRetryAfterMs } from './provider-call'

const fingerprint = (value: string) =>
  value.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)

describe('Google quota and refresh coordination', () => {
  it('shares quota by credential, project, and endpoint with bounded retry advice', async () => {
    let now = 1_000
    const quota = createInMemoryGoogleQuotaCoordinator({
      nowMs: () => now,
      capacity: 2,
      refillTokensPerSecond: 1,
    })
    const key = {
      credentialFingerprint: fingerprint('a'),
      projectFingerprint: fingerprint('b'),
      endpointClass: 'performance' as const,
      organizationId: 'organization-1',
      initiatorUserId: 'user-1',
      connectionId: 'connection-1',
      propertyId: 'property-1',
    }
    await expect(quota.acquire(key, 2, 3_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(quota.acquire(key, 1, 3_000)).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 1_000,
    })
    now = 2_000
    await expect(quota.acquire(key, 1, 3_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
  })

  it('bounds Retry-After and exponential backoff to five through 300 seconds', () => {
    expect(parseGoogleRetryAfterMs('120', 1_000)).toBe(120_000)
    expect(parseGoogleRetryAfterMs('999', 1_000)).toBe(300_000)
    expect(parseGoogleRetryAfterMs(new Date(101_000).toUTCString(), 1_000)).toBe(100_000)
    expect(parseGoogleRetryAfterMs('malformed', 1_000)).toBeNull()
    expect(
      googleRetryDelayMs({
        attempt: 1,
        nowMs: 1_000,
        retryAfter: null,
        jitter: 1,
      }),
    ).toBe(5_000)
    expect(
      googleRetryDelayMs({
        attempt: 20,
        nowMs: 1_000,
        retryAfter: null,
        jitter: 1,
      }),
    ).toBe(300_000)
    expect(
      googleRetryDelayMs({
        attempt: 1,
        nowMs: 1_000,
        retryAfter: '120',
        jitter: 0,
      }),
    ).toBe(120_000)
  })
})
