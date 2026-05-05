// Integration context — list GBP locations use case
// Steps: authorize → find connection → check status → decrypt → call API → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GbpLocation } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ListLocationsInput } from '../dto/list-locations.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type ListGbpLocationsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  gbpApi: GbpApiPort
  encryption: TokenEncryptionPort
}>

export const listGbpLocations =
  (deps: ListGbpLocationsDeps) =>
  async (input: ListLocationsInput, ctx: AuthContext): Promise<ReadonlyArray<GbpLocation>> => {
    // 1. Authorize
    if (!can(ctx.role, 'property.create')) {
      throw integrationError('forbidden', 'You do not have permission to create properties')
    }

    const connectionId = googleConnectionId(input.connectionId)

    // 2. Find connection
    const connection = await deps.connectionRepo.findById(ctx.organizationId, connectionId)
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 3. Check status is active
    if (connection.status !== 'active') {
      throw integrationError('connection_disconnected', 'Google account is not connected')
    }

    // 4. Decrypt access token
    const accessToken = deps.encryption.decrypt(connection.encryptedAccessToken)

    // 5. Call GBP API
    const locations = await deps.gbpApi.listLocations(accessToken, connection.googleAccountId)

    return locations
  }

export type ListGbpLocations = ReturnType<typeof listGbpLocations>
