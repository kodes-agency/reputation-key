import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { GoogleProviderRouteKey } from '#/shared/google-provider-control/contracts'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'

export type GoogleProviderCredentialAdmission = (
  input: Readonly<{
    routeKey: GoogleProviderRouteKey
    authorization: GoogleProviderCallAuthorization
  }>,
) => Promise<boolean>

type AdmissionRow = Readonly<{
  status: string
  credential_use_state: string
  lifecycle_version: number
  access_version: number
  credential_generation: number
}>

const RECONNECTABLE_STATUS: Readonly<Record<string, true>> = {
  active: true,
  degraded: true,
  reauth_required: true,
  disconnected: true,
}
const RECONNECTABLE_USE_STATE: Readonly<Record<string, true>> = {
  active: true,
  none: true,
}

function vectorMatchesConnection(
  authorization: GoogleProviderCallAuthorization,
  row: AdmissionRow,
): boolean {
  const vector = authorization.authorizationVector
  return (
    vector.connectionLifecycleVersion === row.lifecycle_version &&
    vector.connectionAccessVersion === row.access_version &&
    vector.credentialGeneration === row.credential_generation &&
    authorization.expectedCredentialGeneration === row.credential_generation
  )
}

/**
 * Last-mile credential liveness check immediately before permit issuance.
 * The single deployment owns every connection, so admission depends only on
 * the connection's current lifecycle, access, and credential generations.
 */
export const createGoogleProviderCredentialAdmission = (
  db: Pick<Database, 'execute'>,
): GoogleProviderCredentialAdmission => {
  return async (input) => {
    const authorization = input.authorization
    const result = await db.execute(sql`
      SELECT status, credential_use_state, lifecycle_version,
             access_version, credential_generation
      FROM google_connections
      WHERE organization_id = ${authorization.organizationId}
        AND id = ${authorization.connectionId}::uuid
      LIMIT 1
    `)
    const row = result.rows[0] as AdmissionRow | undefined
    const vector = authorization.authorizationVector
    const oauthExchange =
      input.routeKey === 'oauth.token.exchange' &&
      authorization.capability === 'property.import_gbp_v2' &&
      authorization.propertyId === null &&
      authorization.initiatorUserId !== null

    if (oauthExchange && vector.oauthCredentialOperation === 'exchange_new') {
      return (
        row === undefined &&
        authorization.expectedCredentialGeneration === 0 &&
        vector.credentialGeneration === 0
      )
    }
    if (!row || !vectorMatchesConnection(authorization, row)) return false

    if (oauthExchange && vector.oauthCredentialOperation === 'exchange_existing') {
      return (
        RECONNECTABLE_STATUS[row.status] === true &&
        RECONNECTABLE_USE_STATE[row.credential_use_state] === true &&
        vector.connectionStatus === row.status &&
        vector.credentialUseState === row.credential_use_state
      )
    }

    return row.status === 'active' && row.credential_use_state === 'active'
  }
}
