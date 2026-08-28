import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  dataCellById,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import type { GoogleProviderRouteKey } from '#/shared/google-provider-control/contracts'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'

export type DirectGoogleProviderCredentialAdmission = (
  input: Readonly<{
    routeKey: GoogleProviderRouteKey
    authorization: GoogleProviderCallAuthorization
  }>,
) => Promise<'direct' | 'credential_home_unavailable' | 'credential_home_mismatch'>

/**
 * Last-mile defense immediately before permit issuance/provider egress. Both
 * the connection binding and the independent canonical Organization authority
 * must be exact; a legacy/missing/conflicting authority never degrades to a
 * connection-only decision.
 */
export const createDirectGoogleProviderCredentialAdmission = (
  deps: Readonly<{
    db: Pick<Database, 'execute'>
    localCellId: DataCellId
  }>,
): DirectGoogleProviderCredentialAdmission => {
  return async (input) => {
    const authorization = input.authorization
    const result = await deps.db.execute(sql`
      SELECT c.id AS connection_id,
             c.credential_home_cell_id AS connection_home_cell_id,
             c.credential_home_policy_version AS connection_policy_version,
             c.credential_home_authority_generation AS connection_authority_generation,
             c.status, c.credential_use_state, c.lifecycle_version,
             c.access_version, c.credential_generation,
             h.home_cell_id AS authority_home_cell_id,
             h.catalogue_policy_version AS authority_policy_version,
             h.authority_generation AS authority_generation
      FROM google_organization_credential_homes h
      LEFT JOIN google_connections c
        ON c.organization_id = h.organization_id
       AND c.id = ${authorization.connectionId}::uuid
      WHERE h.organization_id = ${authorization.organizationId}
        AND h.superseded_at IS NULL
      LIMIT 2
    `)
    if (result.rows.length !== 1) return 'credential_home_unavailable'
    const row = result.rows[0]!
    const authorityCell =
      typeof row.authority_home_cell_id === 'string'
        ? dataCellById(row.authority_home_cell_id)?.id
        : undefined
    const vector = authorization.authorizationVector
    const prospectiveExchange =
      input.routeKey === 'oauth.token.exchange' &&
      authorization.capability === 'property.import_gbp_v2' &&
      authorization.propertyId === null &&
      authorization.initiatorUserId !== null &&
      authorization.expectedCredentialGeneration === 0 &&
      vector.oauthCredentialOperation === 'exchange_new'
    if (prospectiveExchange) {
      if (
        row.connection_id !== null ||
        !authorityCell ||
        row.authority_policy_version !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
        typeof row.authority_generation !== 'number' ||
        !Number.isSafeInteger(row.authority_generation) ||
        row.authority_generation < 1 ||
        vector.credentialGeneration !== 0 ||
        vector.credentialHomeCellId !== authorityCell ||
        vector.credentialHomePolicyVersion !== row.authority_policy_version ||
        vector.credentialHomeAuthorityGeneration !== row.authority_generation
      ) {
        return 'credential_home_unavailable'
      }
      return authorityCell === deps.localCellId ? 'direct' : 'credential_home_mismatch'
    }

    const existingExchange =
      input.routeKey === 'oauth.token.exchange' &&
      authorization.capability === 'property.import_gbp_v2' &&
      authorization.propertyId === null &&
      authorization.initiatorUserId !== null &&
      vector.oauthCredentialOperation === 'exchange_existing'
    if (existingExchange) {
      const exactConnectionHome =
        row.connection_home_cell_id === authorityCell &&
        row.connection_policy_version === row.authority_policy_version &&
        row.connection_authority_generation === row.authority_generation
      const legacyReconnect =
        row.status === 'disconnected' &&
        row.credential_use_state === 'none' &&
        row.connection_home_cell_id === null &&
        row.connection_policy_version === null &&
        row.connection_authority_generation === null
      if (
        !authorityCell ||
        row.authority_policy_version !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
        typeof row.authority_generation !== 'number' ||
        !Number.isSafeInteger(row.authority_generation) ||
        row.authority_generation < 1 ||
        !['active', 'degraded', 'reauth_required', 'disconnected'].includes(
          String(row.status),
        ) ||
        !['active', 'none'].includes(String(row.credential_use_state)) ||
        (!exactConnectionHome && !legacyReconnect) ||
        vector.connectionStatus !== row.status ||
        vector.credentialUseState !== row.credential_use_state ||
        vector.connectionLifecycleVersion !== row.lifecycle_version ||
        vector.connectionAccessVersion !== row.access_version ||
        vector.credentialGeneration !== row.credential_generation ||
        authorization.expectedCredentialGeneration !== row.credential_generation ||
        vector.credentialHomeCellId !== authorityCell ||
        vector.credentialHomePolicyVersion !== row.authority_policy_version ||
        vector.credentialHomeAuthorityGeneration !== row.authority_generation
      ) {
        return 'credential_home_unavailable'
      }
      return authorityCell === deps.localCellId ? 'direct' : 'credential_home_mismatch'
    }

    const connectionCell =
      typeof row.connection_home_cell_id === 'string'
        ? dataCellById(row.connection_home_cell_id)?.id
        : undefined
    if (
      row.status !== 'active' ||
      row.credential_use_state !== 'active' ||
      !connectionCell ||
      !authorityCell ||
      row.connection_policy_version !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
      row.authority_policy_version !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
      typeof row.connection_authority_generation !== 'number' ||
      row.connection_authority_generation < 1 ||
      !Number.isSafeInteger(row.connection_authority_generation) ||
      row.connection_authority_generation !== row.authority_generation ||
      connectionCell !== authorityCell
    ) {
      return 'credential_home_unavailable'
    }
    return connectionCell === deps.localCellId ? 'direct' : 'credential_home_mismatch'
  }
}
