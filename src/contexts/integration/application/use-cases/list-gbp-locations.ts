// Integration context — list GBP locations use case
// Orchestration only: authorize → token → fetch → filter already-imported.
// The connection gate + token expiry decision table live in
// ActiveConnectionTokenProvider; account iteration, dedupe, wildcard fallback,
// and the retry decision table live in GbpLocationFetchStrategy.

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection, GbpLocation } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ListLocationsInput } from '../dto/list-locations.dto'
export type { ListLocationsInput as ListGbpLocationsInput } from '../dto/list-locations.dto'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import type { OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createActiveConnectionTokenProvider } from '../active-connection-token-provider'
import { createGbpLocationFetchStrategy } from '../gbp-location-fetch-strategy'

export type ListGbpLocationsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  gbpApi: GbpApiPort
  encryption: TokenEncryptionPort
  clock: () => Date
  refreshGoogleToken: (
    orgId: OrganizationId,
    connectionId: string,
  ) => Promise<GoogleConnection>
  logger: LoggerPort
  propertyApi: PropertyPublicApi
}>

export const listGbpLocations = (deps: ListGbpLocationsDeps) => {
  const tokenProvider = createActiveConnectionTokenProvider(deps)
  const fetchStrategy = createGbpLocationFetchStrategy(deps)

  return async (
    input: ListLocationsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    // Uses integration.manage to match the server fn authorization
    // 1. Authorize
    if (!canForContext(ctx, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'Insufficient permissions to manage integrations',
      )
    }

    // 2. Access token for the active connection (provider owns the status gate
    //    and the refresh-vs-decrypt expiry decision table)
    const accessToken = await tokenProvider.getAccessToken(
      ctx.organizationId,
      input.connectionId,
    )

    // 3. List locations (strategy owns account iteration, name-mangling,
    //    gbpPlaceId dedupe, the wildcard fallback, and the retry decision table)
    const locations = await fetchStrategy.fetchLocations(accessToken, {
      connectionId: input.connectionId,
      organizationId: ctx.organizationId,
    })

    // 4. Filter out already-imported locations
    const gbpPlaceIds = locations.map((l) => l.gbpPlaceId)
    const existingIds = new Set(
      await deps.propertyApi.findExistingGbpPlaceIds(ctx.organizationId, gbpPlaceIds),
    )
    const unimported = locations.filter((l) => !existingIds.has(l.gbpPlaceId))

    return unimported
  }
}

export type ListGbpLocations = ReturnType<typeof listGbpLocations>
