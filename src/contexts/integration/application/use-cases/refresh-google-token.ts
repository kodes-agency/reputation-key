// Integration context — refresh Google token use case
// Called internally by sync jobs, not by users. Takes (orgId, connectionId) NOT AuthContext.
// Steps: find connection → check status → check expiry → decrypt → refresh → encrypt → update → return
// A grant Google refuses for good ends instead in reauth_required (requireReauthorization).

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import { googleConnectionId } from '#/shared/domain/ids'
import {
  integrationError,
  isIntegrationError,
  reauthorizationRequiredError,
  unusableConnectionError,
} from '../../domain/errors'
import { integrationGoogleAccountReauthorizationRequired } from '../../domain/events'
import { TOKEN_EXPIRY_BUFFER_MS } from '../constants'
import type { GoogleRefreshCoordination } from '../ports/google-refresh-coordination.port'

const REFRESH_COORDINATION_DEADLINE_MS = 25_000

export type RefreshGoogleTokenOptions = Readonly<{
  force?: boolean
  expectedCredentialGeneration?: number
}>

export type RefreshGoogleTokenDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  /** Records a grant Google refused for good together with its fact. */
  commandStore: Pick<IntegrationCommandStore, 'requireReauthorization'>
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  clock: () => Date
  coordination?: GoogleRefreshCoordination
  authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer
}>

/** Refuses a connection whose credential may no longer be used. */
const assertUsableAuthority = (
  connection: GoogleConnection,
  message: string,
): GoogleConnection => {
  if (connection.status !== 'active' || connection.credentialUseState !== 'active') {
    throw unusableConnectionError(connection.status, message)
  }
  return connection
}

/**
 * Google refused the refresh grant for good. The connection moves to
 * reauth_required with its reauthorization fact, fenced on the generations
 * this refresh started from: a reconnect, disconnect or departure that
 * committed meanwhile wins, and the caller learns only what the row now says.
 */
async function requireReauthorization(
  deps: RefreshGoogleTokenDeps,
  connection: GoogleConnection,
): Promise<Error> {
  const transitioned = await deps.commandStore.requireReauthorization({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    expected: {
      lifecycleVersion: connection.lifecycleVersion,
      credentialGeneration: connection.credentialGeneration,
    },
    event: integrationGoogleAccountReauthorizationRequired({
      connectionId: connection.id,
      organizationId: connection.organizationId,
      cause: 'provider_revoked',
      occurredAt: deps.clock(),
    }),
  })
  if (transitioned) return reauthorizationRequiredError()
  const latest = await deps.connectionRepo.findById(
    connection.organizationId,
    connection.id,
  )
  return latest
    ? unusableConnectionError(
        latest.status,
        'Credential authority changed during token refresh',
      )
    : integrationError(
        'connection_not_found',
        'Connection not found during token refresh',
      )
}

/** The provider call. A grant Google refuses for good is recorded, then refused. */
async function refreshAtGoogle(
  deps: RefreshGoogleTokenDeps,
  connection: GoogleConnection,
  providerAuthorization: Parameters<GoogleOAuthPort['refreshAccessToken']>[1],
  assertLeadership: () => Promise<void>,
): ReturnType<GoogleOAuthPort['refreshAccessToken']> {
  const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
  try {
    return await deps.oauth.refreshAccessToken(refreshToken, providerAuthorization)
  } catch (error) {
    if (!isIntegrationError(error) || error.code !== 'reauthorization_required') {
      throw error
    }
    // Only the current lease owner records it; the generations fence the rest.
    await assertLeadership()
    throw await requireReauthorization(deps, connection)
  }
}

export const refreshGoogleToken =
  (deps: RefreshGoogleTokenDeps) =>
  async (
    orgId: OrganizationId,
    connectionIdStr: string,
    options: RefreshGoogleTokenOptions = {},
  ): Promise<GoogleConnection> => {
    const connectionId = googleConnectionId(connectionIdStr)

    // 1. Find connection
    const connection = await deps.connectionRepo.findById(orgId, connectionId)
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 2. Check status
    assertUsableAuthority(connection, 'Cannot refresh token for disconnected connection')

    // 3. Check if token needs refresh (5 min buffer)
    const now = deps.clock().getTime()
    const expiresAt = connection.tokenExpiresAt.getTime()

    if (!options.force && expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
      return connection
    }
    if (
      options.expectedCredentialGeneration !== undefined &&
      connection.credentialGeneration !== options.expectedCredentialGeneration
    ) {
      return connection
    }

    const loadCommittedReplicaRefresh = async (): Promise<GoogleConnection | null> => {
      const latest = await deps.connectionRepo.findById(orgId, connectionId)
      if (!latest) {
        throw integrationError(
          'connection_not_found',
          'Connection not found during token refresh',
        )
      }
      // Another replica may have moved the connection out of `active` (a
      // revoked grant keeps its generation), so check that before waiting.
      assertUsableAuthority(latest, 'Credential authority changed during token refresh')
      if (latest.credentialGeneration === connection.credentialGeneration) return null
      return latest
    }

    const performRefresh = async (
      assertLeadership: () => Promise<void>,
    ): Promise<GoogleConnection> => {
      // Credential material is not decrypted until the replica owns the
      // renewable Redis lease and shared failure backoff has admitted it.
      const providerAuthorization = deps.authorizeProviderCall
        ? await deps.authorizeProviderCall({
            operation: 'oauth.token.refresh',
            organizationId: orgId,
            connectionId,
            initiatorUserId: connection.credentialAuthorizedBy,
          })
        : undefined
      const refreshResult = await refreshAtGoogle(
        deps,
        connection,
        providerAuthorization,
        assertLeadership,
      )
      const tokenExpiresAt = new Date(now + refreshResult.expiresIn * 1000)
      const encryptedAccessToken = deps.encryption.encrypt(refreshResult.accessToken)

      // Re-prove the exact Redis owner immediately before the database CAS.
      // The connection generation is the durable fence if leadership moved.
      await assertLeadership()
      const updated = await deps.connectionRepo.updateTokens(
        orgId,
        connectionId,
        {
          lifecycleVersion: connection.lifecycleVersion,
          credentialGeneration: connection.credentialGeneration,
        },
        encryptedAccessToken,
        connection.encryptedRefreshToken,
        tokenExpiresAt,
      )
      if (!updated) {
        throw integrationError(
          'connection_disconnected',
          'Credential authority changed during token refresh',
        )
      }

      const updatedConnection = await deps.connectionRepo.findById(orgId, connectionId)
      if (!updatedConnection) {
        throw integrationError(
          'connection_not_found',
          'Connection not found after token refresh',
        )
      }
      return assertUsableAuthority(
        updatedConnection,
        'Credential authority changed after token refresh',
      )
    }

    if (!deps.coordination) return performRefresh(async () => undefined)
    const coordinated = await deps.coordination.run({
      organizationId: orgId,
      connectionId,
      expectedCredentialGeneration: connection.credentialGeneration,
      deadlineMs: now + REFRESH_COORDINATION_DEADLINE_MS,
      loadLatest: loadCommittedReplicaRefresh,
      refresh: performRefresh,
    })
    if (!coordinated.ok) {
      throw integrationError(
        'token_refresh_failed',
        `Google token refresh coordination denied (${coordinated.code})`,
      )
    }
    return coordinated.value
  }

export type RefreshGoogleToken = ReturnType<typeof refreshGoogleToken>
