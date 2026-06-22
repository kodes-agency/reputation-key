// Integration context — list GBP locations use case
// Steps: authorize → find connection → check status → refresh token if expired → decrypt → list accounts → list locations → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection, GbpLocation } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ListLocationsInput } from '../dto/list-locations.dto'
export type { ListLocationsInput as ListGbpLocationsInput } from '../dto/list-locations.dto'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import type { GbpApiError } from '../../domain/gbp-api-error'
import { TOKEN_EXPIRY_BUFFER_MS } from '../constants'
import type { LoggerPort } from '#/shared/domain/logger.port'

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

export const listGbpLocations =
  (deps: ListGbpLocationsDeps) =>
  async (
    input: ListLocationsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    // Uses integration.manage to match the server fn authorization
    // 1. Authorize
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'Insufficient permissions to manage integrations',
      )
    }

    const connectionId = googleConnectionId(input.connectionId)

    // 2. Find connection
    const connection = await deps.connectionRepo.findById(
      ctx.organizationId,
      connectionId,
    )
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 3. Check status is active
    if (connection.status !== 'active') {
      throw integrationError('connection_disconnected', 'Google account is not connected')
    }

    // 4. Refresh token if expired
    let accessToken: string
    const now = deps.clock().getTime()
    const expiresAt = connection.tokenExpiresAt.getTime()

    if (expiresAt <= now + TOKEN_EXPIRY_BUFFER_MS) {
      const refreshed = await deps.refreshGoogleToken(
        ctx.organizationId,
        input.connectionId,
      )
      accessToken = deps.encryption.decrypt(refreshed.encryptedAccessToken)
    } else {
      accessToken = deps.encryption.decrypt(connection.encryptedAccessToken)
    }

    // 5. List locations — try each account, fall back to wildcard
    //    Only retry on permission/account-scope errors — propagate auth and rate-limit errors.
    const isGbpApiError = (err: unknown): err is GbpApiError =>
      typeof err === 'object' &&
      err !== null &&
      '_tag' in err &&
      (err as GbpApiError)._tag === 'GbpApiError'

    const isRetryableError = (err: unknown): boolean => {
      if (isGbpApiError(err)) {
        if ([401, 403, 429].includes(err.status)) return false
      }
      return true
    }

    let locations: ReadonlyArray<GbpLocation>

    try {
      const accounts = await deps.gbpApi.listAccounts(accessToken)

      if (accounts.length > 0) {
        // Query all accounts and merge results (multi-account users)
        // Deduplicate by gbpPlaceId — overlapping accounts share locations
        const seen = new Map<string, GbpLocation>()
        for (const account of accounts) {
          const accountLocations = await deps.gbpApi.listLocations(
            accessToken,
            account.accountName,
          )
          for (const loc of accountLocations) {
            if (!seen.has(loc.gbpPlaceId)) {
              const name = loc.name.startsWith('accounts/')
                ? loc.name
                : `accounts/${account.accountName}/${loc.name}`
              seen.set(loc.gbpPlaceId, { ...loc, name })
            }
          }
        }
        locations = [...seen.values()]
      } else {
        locations = await deps.gbpApi.listLocations(accessToken, '-')
      }
    } catch (originalErr) {
      if (!isRetryableError(originalErr)) throw originalErr

      try {
        locations = await deps.gbpApi.listLocations(accessToken, '-')
      } catch (err) {
        deps.logger.warn(
          { err, connectionId: input.connectionId, organizationId: ctx.organizationId },
          'Wildcard GBP location listing also failed',
        )
        throw originalErr
      }
    }

    // 6. Filter out already-imported locations
    const gbpPlaceIds = locations.map((l) => l.gbpPlaceId)
    const existingIds = new Set(
      await deps.propertyApi.findExistingGbpPlaceIds(ctx.organizationId, gbpPlaceIds),
    )
    const unimported = locations.filter((l) => !existingIds.has(l.gbpPlaceId))

    return unimported
  }

export type ListGbpLocations = ReturnType<typeof listGbpLocations>
