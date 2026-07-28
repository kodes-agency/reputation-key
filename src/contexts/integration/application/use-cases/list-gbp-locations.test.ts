// Integration context — list GBP locations use case tests
// Orchestration-level coverage only: authorization, the happy path through the
// token provider + fetch strategy, and the already-imported filter.
// The token expiry decision table moved to active-connection-token-provider.test.ts;
// the account/dedupe/wildcard/retry tables moved to gbp-location-fetch-strategy.test.ts.

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
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'

const FIXED_NOW = new Date('2026-06-01T12:00:00Z')

const withFixedNow = <T>(fn: () => Promise<T>): Promise<T> => fn()

// --- Shared helpers ----------------------------------------------------------

const setup = (propertyApiOverrides?: Partial<PropertyPublicApi>) => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const gbpApi = createInMemoryGbpApiPort()
  const encryption = createInMemoryTokenEncryption()

  const refreshGoogleToken = async (orgId: string, connectionId: string) => {
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
    ...propertyApiOverrides,
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

  return { useCase, connectionRepo, gbpApi }
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

  it('propagates the token provider gate (connection not found)', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ connectionId: 'nonexistent-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('filters out already-imported locations', async () => {
    const existingIds: string[] = ['ChIJ-already-imported']
    const { useCase, connectionRepo, gbpApi } = setup({
      findExistingGbpPlaceIds: async () => existingIds,
    } as Partial<PropertyPublicApi>)
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
