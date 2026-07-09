// Integration context — list GBP locations use case tests

import { describe, it, expect } from 'vitest'
import { listGbpLocations } from './list-gbp-locations'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryGbpApiPort } from '#/shared/testing/in-memory-gbp-api-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
  buildTestGbpLocation,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { createGbpApiError } from '../../domain/gbp-api-error'
import type { GbpApiErrorKind } from '../../domain/gbp-api-error'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'

const FIXED_NOW = new Date('2026-06-01T12:00:00Z')

const withFixedNow = <T>(fn: () => Promise<T>): Promise<T> => fn()

// --- Shared helpers ----------------------------------------------------------

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const gbpApi = createInMemoryGbpApiPort()
  const encryption = createInMemoryTokenEncryption()

  const refreshCalls: Array<{ orgId: string; connectionId: string }> = []
  const refreshGoogleToken = async (orgId: string, connectionId: string) => {
    refreshCalls.push({ orgId, connectionId })
    const existing = await connectionRepo.findById(orgId as never, connectionId as never)
    if (!existing) throw new Error('Connection not found for refresh')
    return {
      ...existing,
      encryptedAccessToken: 'enc:refreshed-access-token',
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3600_000),
    }
  }

  const propertyApi = {
    findExistingGbpPlaceIds: async (_orgId: string, _ids: ReadonlyArray<string>) =>
      [] as string[],
  } as unknown as PropertyPublicApi

  const deps = {
    connectionRepo,
    gbpApi,
    encryption,
    clock: () => FIXED_NOW,
    refreshGoogleToken,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    } as never,
    propertyApi,
  }
  const useCase = listGbpLocations(deps)

  return {
    useCase,
    connectionRepo,
    gbpApi,
    encryption,
    refreshCalls: () => refreshCalls,
  }
}

/** Seeds an active connection with a PropertyManager auth context. */
const seedActiveConnection = (
  deps: Pick<ReturnType<typeof setup>, 'connectionRepo'>,
  overrides: Parameters<typeof buildTestGoogleConnection>[0] = {},
) => {
  const ctx = buildTestAuthContext({ role: 'PropertyManager' })
  const conn = buildTestGoogleConnection({
    status: 'active',
    tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3600_000),
    ...overrides,
  })
  deps.connectionRepo.seed([conn])
  return { ctx, conn }
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

// --- Tests -------------------------------------------------------------------

describe('listGbpLocations', () => {
  it('returns deduped locations for active connection with valid token', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    const loc1 = buildTestGbpLocation({ gbpPlaceId: 'ChIJ-aaa', businessName: 'Biz A' })
    const loc2 = buildTestGbpLocation({ gbpPlaceId: 'ChIJ-bbb', businessName: 'Biz B' })

    gbpApi.setAccounts([createAccount('accounts/111')])
    gbpApi.setLocations('accounts/111', [loc1, loc2])

    const result = await withFixedNow(() =>
      useCase({ connectionId: conn.id as string }, ctx),
    )

    expect(result).toHaveLength(2)
    const placeIds = result.map((l: { gbpPlaceId: string }) => l.gbpPlaceId)
    expect(placeIds).toContain('ChIJ-aaa')
    expect(placeIds).toContain('ChIJ-bbb')
  })

  it('rejects without property.create permission', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ connectionId: 'any-id' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when connection not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ connectionId: 'nonexistent-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('rejects when connection is disconnected', async () => {
    const { useCase, connectionRepo } = setup()
    const { ctx, conn } = seedActiveConnection(
      { connectionRepo },
      { status: 'disconnected' },
    )

    await expect(useCase({ connectionId: conn.id as string }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'connection_disconnected',
    )
  })

  it('refreshes token when expired (within 5-minute buffer)', async () => {
    const { useCase, connectionRepo, gbpApi, refreshCalls } = setup()
    // Token expires in 3 minutes — within the 5-minute buffer
    const almostExpired = new Date(FIXED_NOW.getTime() + 3 * 60 * 1000)
    const { ctx, conn } = seedActiveConnection(
      { connectionRepo },
      { tokenExpiresAt: almostExpired },
    )

    gbpApi.setAccounts([])
    gbpApi.setLocations('-', [])

    await withFixedNow(() => useCase({ connectionId: conn.id as string }, ctx))

    expect(refreshCalls()).toHaveLength(1)
    expect(refreshCalls()[0].connectionId).toBe(conn.id as string)
  })

  it('does NOT refresh token when valid', async () => {
    const { useCase, connectionRepo, gbpApi, refreshCalls } = setup()
    // Token expires in 1 hour — well beyond buffer (already the seedActiveConnection default)
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    gbpApi.setAccounts([])
    gbpApi.setLocations('-', [])

    await withFixedNow(() => useCase({ connectionId: conn.id as string }, ctx))

    expect(refreshCalls()).toHaveLength(0)
  })

  it('deduplicates locations by gbpPlaceId across accounts', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    const sharedLoc = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-shared',
      businessName: 'Shared Biz',
    })
    const onlyInAcct1 = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-acct1-only',
      businessName: 'Account 1 Biz',
    })

    gbpApi.setAccounts([
      createAccount('accounts/111'),
      createAccount('accounts/222', { role: 'MANAGER' }),
    ])
    gbpApi.setLocations('accounts/111', [sharedLoc, onlyInAcct1])
    gbpApi.setLocations('accounts/222', [sharedLoc])

    const result = await withFixedNow(() =>
      useCase({ connectionId: conn.id as string }, ctx),
    )

    expect(result).toHaveLength(2)
    const placeIds = result.map((l: { gbpPlaceId: string }) => l.gbpPlaceId)
    expect(placeIds).toContain('ChIJ-shared')
    expect(placeIds).toContain('ChIJ-acct1-only')
  })

  it('falls back to wildcard when accounts exist but listLocations fails with retryable error', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    const wildcardLoc = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-wildcard-retry',
      businessName: 'Wildcard Biz',
    })
    // listAccounts throws an upstream error (retryable) → falls back to wildcard
    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'upstream_error', 'Server Error'),
    )
    gbpApi.setLocations('-', [wildcardLoc])

    const result = await withFixedNow(() =>
      useCase({ connectionId: conn.id as string }, ctx),
    )

    expect(result).toHaveLength(1)
    expect(result[0].gbpPlaceId).toBe('ChIJ-wildcard-retry')
  })

  it('propagates non-retryable GbpApiError (auth_failed)', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'auth_failed', 'Unauthorized'),
    )

    await withFixedNow(async () => {
      await expect(useCase({ connectionId: conn.id as string }, ctx)).rejects.toSatisfy(
        isGbpApiErrorWithKind('auth_failed'),
      )
    })
  })

  it('propagates non-retryable GbpApiError (permission_denied)', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'permission_denied', 'Forbidden'),
    )

    await withFixedNow(async () => {
      await expect(useCase({ connectionId: conn.id as string }, ctx)).rejects.toSatisfy(
        isGbpApiErrorWithKind('permission_denied'),
      )
    })
  })

  it('propagates non-retryable GbpApiError (rate_limited)', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    gbpApi.setError(
      'listAccounts',
      createGbpApiError('listAccounts', 'rate_limited', 'Rate Limited'),
    )

    await withFixedNow(async () => {
      await expect(useCase({ connectionId: conn.id as string }, ctx)).rejects.toSatisfy(
        isGbpApiErrorWithKind('rate_limited'),
      )
    })
  })

  it('falls back to wildcard when no accounts', async () => {
    const { useCase, connectionRepo, gbpApi } = setup()
    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    const wildcardLoc = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-wildcard-no-accts',
      businessName: 'Wildcard Biz',
    })
    gbpApi.setAccounts([])
    gbpApi.setLocations('-', [wildcardLoc])

    const result = await withFixedNow(() =>
      useCase({ connectionId: conn.id as string }, ctx),
    )

    expect(result).toHaveLength(1)
    expect(result[0].gbpPlaceId).toBe('ChIJ-wildcard-no-accts')
  })

  it('filters out already-imported locations', async () => {
    const connectionRepo = createInMemoryGoogleConnectionRepo()
    const gbpApi = createInMemoryGbpApiPort()
    const encryption = createInMemoryTokenEncryption()

    const existingIds: string[] = ['ChIJ-already-imported']
    const propertyApi = {
      findExistingGbpPlaceIds: async (_orgId: string, _ids: ReadonlyArray<string>) =>
        existingIds,
    } as unknown as PropertyPublicApi

    const deps = {
      connectionRepo,
      gbpApi,
      encryption,
      clock: () => FIXED_NOW,
      refreshGoogleToken: async () => {
        throw new Error('not used')
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        trace: () => {},
        fatal: () => {},
      } as never,
      propertyApi,
    }
    const useCase = listGbpLocations(deps)

    const { ctx, conn } = seedActiveConnection({ connectionRepo })

    const imported = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-already-imported',
      businessName: 'Imported Biz',
    })
    const fresh = buildTestGbpLocation({
      gbpPlaceId: 'ChIJ-fresh',
      businessName: 'Fresh Biz',
    })

    gbpApi.setAccounts([])
    gbpApi.setLocations('-', [imported, fresh])

    const result = await withFixedNow(() =>
      useCase({ connectionId: conn.id as string }, ctx),
    )

    expect(result).toHaveLength(1)
    expect(result[0].gbpPlaceId).toBe('ChIJ-fresh')
  })
})
