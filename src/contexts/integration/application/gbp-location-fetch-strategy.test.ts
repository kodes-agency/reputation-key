// Integration context — GbpLocationFetchStrategy tests
// Owns the account iteration / dedupe / wildcard fallback + retry decision table
// that listGbpLocations no longer knows about.

import { describe, it, expect, vi } from 'vitest'
import {
  createGbpLocationFetchStrategy,
  decideFetchRecovery,
} from './gbp-location-fetch-strategy'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { buildTestGbpLocation } from '#/shared/testing/fixtures'
import { createGbpApiError } from '../domain/gbp-api-error'
import type { GbpApiErrorKind } from '../domain/gbp-api-error'
import type { LoggerPort } from '#/shared/domain/logger.port'

const LOG_CONTEXT = { connectionId: 'conn-1', organizationId: 'org-1' }

const setup = () => {
  const gbpApi = createInMemoryGbpApiPort()
  const logger = {
    info: () => {},
    warn: vi.fn(),
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
  } as unknown as LoggerPort & { warn: ReturnType<typeof vi.fn> }
  const strategy = createGbpLocationFetchStrategy({ gbpApi, logger })
  return { strategy, gbpApi, logger }
}

/** Creates a GBP account object for the in-memory fake. */
const createAccount = (name: string, overrides: Record<string, string> = {}) => ({
  name,
  accountName: name,
  type: 'BUSINESS' as const,
  role: 'OWNER' as const,
  ...overrides,
})

/** Predicate: true when the value is a GbpApiError with the given domain kind. */
const isGbpApiErrorWithKind =
  (expectedKind: GbpApiErrorKind) =>
  (e: unknown): boolean => {
    if (typeof e !== 'object' || e === null || !('_tag' in e) || !('kind' in e))
      return false
    return e._tag === 'GbpApiError' && e.kind === expectedKind
  }

// ── Retry decision table (pure) ─────────────────────────────────
//
//   error kind                       → recovery
//   auth_failed (401)                → propagate
//   permission_denied (403)          → propagate
//   rate_limited (429)               → propagate
//   upstream_error (5xx)             → wildcard-fallback
//   parse_error (bad response shape) → wildcard-fallback
//   not a GbpApiError                → wildcard-fallback

describe('decideFetchRecovery', () => {
  it.each(['auth_failed', 'permission_denied', 'rate_limited'] as const)(
    'propagates non-retryable kind %s',
    (kind) => {
      expect(decideFetchRecovery(createGbpApiError('listAccounts', kind, 'body'))).toBe(
        'propagate',
      )
    },
  )

  it.each(['upstream_error', 'parse_error'] as const)(
    'falls back to wildcard for retryable kind %s',
    (kind) => {
      expect(decideFetchRecovery(createGbpApiError('listAccounts', kind, 'body'))).toBe(
        'wildcard-fallback',
      )
    },
  )

  it('falls back to wildcard for non-GBP errors', () => {
    expect(decideFetchRecovery(new Error('socket hangup'))).toBe('wildcard-fallback')
  })
})

// ── Fetch strategy ──────────────────────────────────────────────

describe('GbpLocationFetchStrategy.fetchLocations', () => {
  it('merges and dedupes locations across accounts by gbpPlaceId', async () => {
    const { strategy, gbpApi } = setup()
    const sharedLoc = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-shared',
      businessName: 'Shared Biz',
    })
    const onlyInAcct1 = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-acct1-only',
      businessName: 'Account 1 Biz',
    })
    gbpApi.setAccounts([createAccount('accounts/111'), createAccount('accounts/222')])
    gbpApi.setLocations('accounts/111', [sharedLoc, onlyInAcct1])
    gbpApi.setLocations('accounts/222', [sharedLoc])

    const result = await strategy.fetchLocations('token', LOG_CONTEXT)

    expect(result).toHaveLength(2)
    const placeIds = result.map((l) => l.gbpPlaceId)
    expect(placeIds).toContain('ChIJ-shared')
    expect(placeIds).toContain('ChIJ-acct1-only')
  })

  it('mangles bare location resource names with the account prefix', async () => {
    const { strategy, gbpApi } = setup()
    const bare = buildTestGbpLocation({ gbpPlaceId: 'ChIJ-bare', name: 'locations/789' })
    const alreadyQualified = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-qualified',
      name: 'accounts/111/locations/456',
    })
    gbpApi.setAccounts([createAccount('accounts/111')])
    gbpApi.setLocations('accounts/111', [bare, alreadyQualified])

    const result = await strategy.fetchLocations('token', LOG_CONTEXT)

    // Pins the pre-refactor behavior exactly: the prefix is `accounts/${accountName}`
    // where accountName itself starts with 'accounts/' (double prefix for bare names).
    const byId = new Map(result.map((l) => [l.gbpPlaceId, l.name]))
    expect(byId.get('ChIJ-bare')).toBe('accounts/accounts/111/locations/789')
    expect(byId.get('ChIJ-qualified')).toBe('accounts/111/locations/456')
  })

  it('falls back to the wildcard listing when there are no accounts', async () => {
    const { strategy, gbpApi } = setup()
    const wildcardLoc = buildTestGbpLocation({ gbpPlaceId: 'ChIJ-wildcard-no-accts' })
    gbpApi.setAccounts([])
    gbpApi.setLocations('-', [wildcardLoc])

    const result = await strategy.fetchLocations('token', LOG_CONTEXT)

    expect(result).toHaveLength(1)
    expect(result[0].gbpPlaceId).toBe('ChIJ-wildcard-no-accts')
  })

  it('falls back to the wildcard listing on a retryable error', async () => {
    const { strategy, gbpApi } = setup()
    const wildcardLoc = buildTestGbpLocation({ gbpPlaceId: 'ChIJ-wildcard-retry' })
    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'upstream_error', 'Server Error'),
    )
    gbpApi.setLocations('-', [wildcardLoc])

    const result = await strategy.fetchLocations('token', LOG_CONTEXT)

    expect(result).toHaveLength(1)
    expect(result[0].gbpPlaceId).toBe('ChIJ-wildcard-retry')
  })

  it('propagates non-retryable GbpApiErrors without a wildcard attempt', async () => {
    const { strategy, gbpApi } = setup()
    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'auth_failed', 'Unauthorized'),
    )
    gbpApi.setLocations('-', [
      buildTestGbpLocation({ gbpPlaceId: 'ChIJ-should-not-serve' }),
    ])

    await expect(strategy.fetchLocations('token', LOG_CONTEXT)).rejects.toSatisfy(
      isGbpApiErrorWithKind('auth_failed'),
    )
  })

  it('rethrows the original error (and warns) when the wildcard fallback also fails', async () => {
    const { strategy, gbpApi, logger } = setup()
    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'upstream_error', 'Server Error'),
    )
    gbpApi.setError(
      'listLocations',
      createGbpApiError('listLocations', 'upstream_error', 'Still down'),
    )

    await expect(strategy.fetchLocations('token', LOG_CONTEXT)).rejects.toSatisfy(
      (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        'operation' in e &&
        e.operation === 'listAccounts',
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      'Wildcard GBP location listing also failed',
    )
  })
})
