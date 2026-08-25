import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  type GoogleProviderAdmissionMetadata,
} from '../../src/shared/google-provider-control/route-catalogue'
import type { GoogleProviderRouteKey } from '../../src/shared/google-provider-control/contracts'
import { googleQuotaCredentialFingerprint } from '../../src/shared/google-provider-control/quota-coordinator'
import type {
  GoogleAdmissionPermitAuthority,
  GoogleAdmissionPermitSnapshot,
  GoogleProviderOutcome,
} from './service'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_REVISION = /^[A-Za-z0-9._:@/-]{1,255}$/

type PermitRow = Readonly<{
  id: string
  capability: string
  route_key: string
  route_catalog_version: string
  quota_policy_id: string
  permit_generation: string | number
  policy_version: string | number
  emergency_kill_version: string | number
  approval_binding_id: string
  authorization_vector: unknown
  state: string
  start_deadline_at: Date
  organization_id: string
  property_id: string | null
  connection_id: string | null
  initiator_user_id: string | null
}>

type AuthorizationVector = Readonly<{
  requestBindingSha256: string
  credentialBinding: string
  projectFingerprint: string
  requestBodySha256: string | null
  requestBodyBytes: number
}>

function parseGeneration(value: string | number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseVector(raw: unknown): AuthorizationVector | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const requestBodySha256 = value.requestBodySha256
  if (
    typeof value.requestBindingSha256 !== 'string' ||
    !SHA256.test(value.requestBindingSha256) ||
    typeof value.credentialBinding !== 'string' ||
    (value.credentialBinding !== 'none' && !SHA256.test(value.credentialBinding)) ||
    typeof value.projectFingerprint !== 'string' ||
    !SHA256.test(value.projectFingerprint) ||
    (requestBodySha256 !== null &&
      (typeof requestBodySha256 !== 'string' || !SHA256.test(requestBodySha256))) ||
    typeof value.requestBodyBytes !== 'number' ||
    !Number.isSafeInteger(value.requestBodyBytes) ||
    value.requestBodyBytes < 0 ||
    (value.requestBodyBytes === 0) !== (requestBodySha256 === null)
  ) {
    return null
  }
  return {
    requestBindingSha256: value.requestBindingSha256,
    credentialBinding: value.credentialBinding,
    projectFingerprint: value.projectFingerprint,
    requestBodySha256,
    requestBodyBytes: value.requestBodyBytes,
  }
}

function revisionFor(row: PermitRow): string | null {
  const permitGeneration = parseGeneration(row.permit_generation)
  const policyVersion = parseGeneration(row.policy_version)
  const emergencyKillVersion = parseGeneration(row.emergency_kill_version)
  if (
    permitGeneration === null ||
    policyVersion === null ||
    emergencyKillVersion === null
  ) {
    return null
  }
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.id,
        permitGeneration,
        policyVersion,
        emergencyKillVersion,
        row.route_key,
        row.capability,
        row.approval_binding_id,
        row.route_catalog_version,
        row.quota_policy_id,
        row.authorization_vector,
        row.start_deadline_at.toISOString(),
      ]),
    )
    .digest('hex')
}

function snapshotFromRow(
  row: PermitRow,
  gatewayIdentity: string,
): GoogleAdmissionPermitSnapshot | null {
  if (
    row.state !== 'admitted' ||
    row.route_catalog_version !== GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION ||
    !(row.route_key in GOOGLE_PROVIDER_ROUTE_POLICIES) ||
    !(row.start_deadline_at instanceof Date) ||
    Number.isNaN(row.start_deadline_at.getTime())
  ) {
    return null
  }
  const routeKey = row.route_key as GoogleProviderRouteKey
  const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]
  if (!policy || policy.quotaPolicyId !== row.quota_policy_id) return null
  const vector = parseVector(row.authorization_vector)
  const authorityRevision = revisionFor(row)
  const permitGeneration = parseGeneration(row.permit_generation)
  const policyVersion = parseGeneration(row.policy_version)
  const emergencyKillVersion = parseGeneration(row.emergency_kill_version)
  if (
    !vector ||
    !authorityRevision ||
    permitGeneration === null ||
    permitGeneration < 1 ||
    policyVersion === null ||
    emergencyKillVersion === null
  ) {
    return null
  }
  const quotaCredentialFingerprint = googleQuotaCredentialFingerprint(
    vector.credentialBinding,
    vector.projectFingerprint,
  )
  if (!quotaCredentialFingerprint) return null
  const expectedAdmission: GoogleProviderAdmissionMetadata = Object.freeze({
    routeKey,
    catalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    endpointClass: policy.endpointClass,
    requestClass: policy.requestClass,
    requestBindingSha256: vector.requestBindingSha256,
    credentialBinding: vector.credentialBinding,
    requestBodySha256: vector.requestBodySha256,
    requestBodyBytes: vector.requestBodyBytes,
    maxRequestBytes: policy.maxRequestBytes,
    maxResponseBytes: policy.maxResponseBytes,
    quotaPolicyId: policy.quotaPolicyId,
    inFlightPolicyId: policy.inFlightPolicyId,
  })
  return Object.freeze({
    permitId: row.id,
    kind: routeKey === 'oauth.revoke' ? 'credential_cleanup' : 'work',
    gatewayIdentity,
    routeKey,
    routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    expectedAdmission,
    quotaKey: Object.freeze({
      credentialFingerprint: quotaCredentialFingerprint,
      projectFingerprint: vector.projectFingerprint,
      endpointClass: policy.endpointClass,
      organizationId: row.organization_id,
      initiatorUserId: row.initiator_user_id,
      connectionId: row.connection_id,
      propertyId: row.property_id,
    }),
    expiresAtMs: row.start_deadline_at.getTime(),
    permitGeneration,
    policyVersion,
    emergencyKillVersion,
    authorityRevision,
  })
}

async function selectPermit(
  client: Pool | PoolClient,
  permitId: string,
  forUpdate = false,
): Promise<PermitRow | null> {
  const result = await client.query<PermitRow>(
    `SELECT id, capability, route_key, route_catalog_version, quota_policy_id,
            permit_generation, policy_version, emergency_kill_version,
            approval_binding_id, authorization_vector, state, start_deadline_at,
            organization_id, property_id, connection_id, initiator_user_id
       FROM authorization_execution_permits
      WHERE id = $1
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [permitId],
  )
  return result.rows[0] ?? null
}

export function createPostgresGoogleAdmissionPermitAuthority(
  deps: Readonly<{
    pool: Pool
    now: () => Date
    gatewayIdentity: string
    operationTimeoutMs?: number
  }>,
): GoogleAdmissionPermitAuthority {
  const operationTimeoutMs = deps.operationTimeoutMs ?? 60_000
  if (
    !SAFE_REVISION.test(deps.gatewayIdentity) ||
    !Number.isSafeInteger(operationTimeoutMs) ||
    operationTimeoutMs < 1_000 ||
    operationTimeoutMs > 120_000
  ) {
    throw new Error('Google admission authority configuration is invalid')
  }
  return Object.freeze({
    load: async (permitId) => {
      const row = await selectPermit(deps.pool, permitId)
      return row ? snapshotFromRow(row, deps.gatewayIdentity) : null
    },
    start: async (permit) => {
      const now = deps.now()
      const operationDeadlineAt = new Date(now.getTime() + operationTimeoutMs)
      const result = await deps.pool.query<{ outcome: string }>(
        `WITH candidate AS MATERIALIZED (
           SELECT permit.*,
                  CASE
                    WHEN permit.state <> 'admitted' THEN 'changed'
                    WHEN permit.start_deadline_at <= $2 THEN 'expired'
                    WHEN EXISTS (
                      SELECT 1
                        FROM policy_version AS policy
                        INNER JOIN capability_execution_control AS control
                          ON control.capability = permit.capability
                        INNER JOIN capability_compliance_approvals AS approval
                          ON approval.id = permit.approval_binding_id
                         AND approval.capability = permit.capability
                       WHERE policy.scope = 'global'
                         AND policy.version = permit.policy_version
                         AND policy.emergency_kill_version = permit.emergency_kill_version
                         AND control.denied = false
                         AND control.emergency_kill_version = policy.emergency_kill_version
                         AND approval.status = 'approved'
                         AND approval.approved_at <= $2
                         AND approval.expires_at > $2
                         AND (
                           approval.target_phase <> 'railway_closed_beta'
                           OR approval.railway_closed_beta_cohort @>
                             to_jsonb(ARRAY[permit.organization_id]::text[])
                         )
                         AND NOT EXISTS (
                           SELECT 1
                             FROM capability_compliance_approvals AS newer
                            WHERE newer.capability = approval.capability
                              AND newer.target_phase = approval.target_phase
                              AND newer.environment_profile = approval.environment_profile
                              AND newer.binding_version > approval.binding_version
                         )
                    ) THEN 'started'
                    ELSE 'changed'
                  END AS outcome
             FROM authorization_execution_permits AS permit
            WHERE permit.id = $1
            FOR UPDATE OF permit
         ), transition AS (
           UPDATE authorization_execution_permits AS permit
              SET state = CASE WHEN candidate.outcome = 'started'
                                 THEN 'started'::authorization_execution_permit_state
                               ELSE 'fenced'::authorization_execution_permit_state END,
                  started_at = CASE WHEN candidate.outcome = 'started'
                                      THEN $2 ELSE permit.started_at END,
                  operation_deadline_at = CASE WHEN candidate.outcome = 'started'
                                                 THEN $3
                                                 ELSE permit.operation_deadline_at END,
                  fenced_at = CASE WHEN candidate.outcome = 'started'
                                     THEN permit.fenced_at ELSE $2 END,
                  correlation_id = CASE WHEN candidate.outcome = 'started'
                                          THEN permit.correlation_id
                                        WHEN candidate.outcome = 'expired'
                                          THEN 'start_deadline_elapsed'
                                        ELSE 'authorization_changed' END
             FROM candidate
            WHERE permit.id = candidate.id
              AND candidate.state = 'admitted'
              AND candidate.permit_generation = $4
              AND candidate.policy_version = $5
              AND candidate.emergency_kill_version = $6
              AND candidate.route_key = $7
              AND candidate.route_catalog_version = $8
              AND candidate.quota_policy_id = $9
              AND candidate.authorization_vector @> $10::jsonb
           RETURNING candidate.outcome
         )
         SELECT transition.outcome FROM transition
         UNION ALL
         SELECT CASE WHEN candidate.start_deadline_at <= $2
                       THEN 'expired' ELSE 'changed' END AS outcome
           FROM candidate
          WHERE NOT EXISTS (SELECT 1 FROM transition)
         LIMIT 1`,
        [
          permit.permitId,
          now,
          operationDeadlineAt,
          permit.permitGeneration,
          permit.policyVersion,
          permit.emergencyKillVersion,
          permit.routeKey,
          permit.routeCatalogueVersion,
          permit.expectedAdmission.quotaPolicyId,
          JSON.stringify({
            requestBindingSha256: permit.expectedAdmission.requestBindingSha256,
            credentialBinding: permit.expectedAdmission.credentialBinding,
            projectFingerprint: permit.quotaKey.projectFingerprint,
            requestBodySha256: permit.expectedAdmission.requestBodySha256,
            requestBodyBytes: permit.expectedAdmission.requestBodyBytes,
          }),
        ],
      )
      const outcome = result.rows[0]?.outcome
      return outcome === 'started' || outcome === 'expired' ? outcome : 'changed'
    },
    failStarted: async (permit, code) => {
      await deps.pool.query(
        `UPDATE authorization_execution_permits
            SET state = 'fenced', fenced_at = $2, correlation_id = $3
          WHERE id = $1
            AND state = 'started'
            AND permit_generation = $4
            AND policy_version = $5
            AND emergency_kill_version = $6
            AND route_key = $7
            AND route_catalog_version = $8
            AND quota_policy_id = $9`,
        [
          permit.permitId,
          deps.now(),
          code,
          permit.permitGeneration,
          permit.policyVersion,
          permit.emergencyKillVersion,
          permit.routeKey,
          permit.routeCatalogueVersion,
          permit.expectedAdmission.quotaPolicyId,
        ],
      )
    },
    complete: async (
      permitId,
      authorityRevision,
      outcome: GoogleProviderOutcome,
      retryAfterMs,
    ) => {
      const client = await deps.pool.connect()
      try {
        await client.query('BEGIN')
        const row = await selectPermit(client, permitId, true)
        if (!row || revisionFor(row) !== authorityRevision || row.state !== 'started') {
          throw new Error('Google admission permit changed before completion')
        }
        const completedAt = deps.now()
        const result = await client.query(
          `UPDATE authorization_execution_permits
              SET state = 'completed', completed_at = $2, correlation_id = $3
            WHERE id = $1 AND state = 'started'`,
          [
            permitId,
            completedAt,
            retryAfterMs === null ? outcome : `${outcome}:retry_after_${retryAfterMs}`,
          ],
        )
        if ((result.rowCount ?? 0) !== 1) {
          throw new Error('Google admission permit changed before completion')
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  })
}
