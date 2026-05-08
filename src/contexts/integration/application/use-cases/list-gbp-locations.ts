// Integration context — list GBP locations use case
// Steps: authorize → find connection → check status → refresh token if expired → decrypt → list accounts → list locations → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection, GbpLocation } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ListLocationsInput } from '../dto/list-locations.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type ListGbpLocationsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  gbpApi: GbpApiPort
  encryption: TokenEncryptionPort
  refreshGoogleToken: (
    orgId: OrganizationId,
    connectionId: string,
  ) => Promise<GoogleConnection>
}>

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

export const listGbpLocations =
  (deps: ListGbpLocationsDeps) =>
  async (
    input: ListLocationsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    // 1. Authorize
    if (!can(ctx.role, 'property.create')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to create properties',
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
    const now = Date.now()
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

    // 5. Try to list locations from available GBP accounts, fall back to wildcard
    //    Only retry on permission/account-scope errors — propagate auth and rate-limit errors.
    const isRetryableError = (err: unknown): boolean => {
      if (!(err instanceof Error)) return true
      const msg = err.message.toLowerCase()
      // Token/auth errors — do NOT retry
      if (msg.includes('401') || msg.includes('403')) return false
      // Rate limiting — do NOT retry
      if (msg.includes('429')) return false
      // Permission/account-scope errors — retry with wildcard
      return true
    }

    let locations: ReadonlyArray<GbpLocation>

    try {
      const accounts = await deps.gbpApi.listAccounts(accessToken)

      if (accounts.length > 0) {
        const firstAccount = accounts[0]
        locations = await deps.gbpApi.listLocations(accessToken, firstAccount.accountName)
      } else {
        locations = await deps.gbpApi.listLocations(accessToken, '-')
      }
    } catch (err) {
      if (!isRetryableError(err)) throw err

      console.error('GBP account-scoped listing failed, retrying with wildcard:', err)

      locations = await deps.gbpApi.listLocations(accessToken, '-')
    }

    return locations
  }

export type ListGbpLocations = ReturnType<typeof listGbpLocations>
