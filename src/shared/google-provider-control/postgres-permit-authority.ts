import type { Pool } from 'pg'
import {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_POLICIES,
  type GoogleProviderAdmissionMetadata,
} from './route-catalogue'
import type { GoogleProviderRouteKey } from './contracts'
import { googleQuotaCredentialFingerprint } from './quota-coordinator'
import type {
  GoogleAdmissionPermitAuthority,
  GoogleAdmissionPermitSnapshot,
  GoogleProviderOutcome,
} from './admission-service'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_REVISION = /^[A-Za-z0-9._:@/-]{1,255}$/
const RELEASE_SHA = /^[a-f0-9]{40}$/

type PermitRow = Readonly<{
  id: string
  capability: string
  route_key: string
  route_catalog_version: string
  quota_policy_id: string
  permit_generation: string | number
  authorization_vector: unknown
  state: string
  start_deadline_at: Date
  organization_id: string
  property_id: string | null
  connection_id: string | null
  initiator_user_id: string | null
  authority_revision: string
}>

type AuthorizationVector = Readonly<{
  requestBindingSha256: string
  credentialBinding: string
  projectFingerprint: string
  requestBodySha256: string | null
  requestBodyBytes: number
}>

export type PostgresGoogleAdmissionPermitAuthority = GoogleAdmissionPermitAuthority &
  Readonly<{ readiness(): Promise<boolean> }>

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

function snapshotFromRow(
  row: PermitRow,
  gatewayIdentity: string,
): GoogleAdmissionPermitSnapshot | null {
  if (
    row.state !== 'admitted' ||
    row.route_catalog_version !== GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION ||
    !(row.route_key in GOOGLE_PROVIDER_ROUTE_POLICIES) ||
    !(row.start_deadline_at instanceof Date) ||
    Number.isNaN(row.start_deadline_at.getTime()) ||
    !SHA256.test(row.authority_revision)
  ) {
    return null
  }
  const routeKey = row.route_key as GoogleProviderRouteKey
  const policy = GOOGLE_PROVIDER_ROUTE_POLICIES[routeKey]
  if (!policy || policy.quotaPolicyId !== row.quota_policy_id) return null
  const vector = parseVector(row.authorization_vector)
  const permitGeneration = parseGeneration(row.permit_generation)
  if (!vector || permitGeneration === null || permitGeneration < 1) return null
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
    authorityRevision: row.authority_revision,
  })
}

export function createPostgresGoogleAdmissionPermitAuthority(
  deps: Readonly<{
    pool: Pool
    gatewayIdentity: string
    releaseSha: string
  }>,
): PostgresGoogleAdmissionPermitAuthority {
  if (!SAFE_REVISION.test(deps.gatewayIdentity) || !RELEASE_SHA.test(deps.releaseSha)) {
    throw new Error('Google admission authority configuration is invalid')
  }
  return Object.freeze({
    load: async (permitId) => {
      const result = await deps.pool.query<PermitRow>(
        'SELECT * FROM load_google_execution_permit_v1($1::uuid)',
        [permitId],
      )
      const row = result.rows[0]
      return row ? snapshotFromRow(row, deps.gatewayIdentity) : null
    },
    start: async (permit) => {
      const result = await deps.pool.query<{ outcome: string }>(
        `SELECT outcome FROM start_google_execution_permit_v3(
          $1::uuid, $2::bigint, $3::text, $4::text, $5::text, $6::jsonb, $7::text
        )`,
        [
          permit.permitId,
          permit.permitGeneration,
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
          deps.releaseSha,
        ],
      )
      const outcome = result.rows[0]?.outcome
      return outcome === 'started' || outcome === 'expired' ? outcome : 'changed'
    },
    failStarted: async (permit, code) => {
      await deps.pool.query(
        `SELECT fail_google_execution_permit_v1(
          $1::uuid, $2::bigint, $3::text, $4::text, $5::text, $6::text
        )`,
        [
          permit.permitId,
          permit.permitGeneration,
          permit.routeKey,
          permit.routeCatalogueVersion,
          permit.expectedAdmission.quotaPolicyId,
          code,
        ],
      )
    },
    complete: async (
      permitId,
      authorityRevision,
      outcome: GoogleProviderOutcome,
      retryAfterMs,
    ) => {
      const result = await deps.pool.query<{ completed: boolean }>(
        `SELECT complete_google_execution_permit_v1(
          $1::uuid, $2::text, $3::text, $4::integer
        ) AS completed`,
        [permitId, authorityRevision, outcome, retryAfterMs],
      )
      if (result.rows[0]?.completed !== true) {
        throw new Error('Google admission permit changed before completion')
      }
    },
    readiness: async () => {
      const result = await deps.pool.query<{ ready: boolean }>(`
        SELECT
          NOT pg_is_in_recovery()
          AND COALESCE((
            SELECT connection.ssl
            FROM pg_catalog.pg_stat_ssl AS connection
            WHERE connection.pid = pg_catalog.pg_backend_pid()
          ), false)
          AND current_setting('lock_timeout') = '1s'
          AND current_setting('statement_timeout') = '3s'
          AND current_setting('idle_in_transaction_session_timeout') = '5s'
          AND has_schema_privilege(current_user, 'public', 'USAGE')
          AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
          AND count(*) = 4
          AND bool_and(
            procedure.prosecdef
            AND has_function_privilege(current_user, procedure.oid, 'EXECUTE')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_class AS direct_table
            INNER JOIN pg_namespace AS direct_schema
              ON direct_schema.oid = direct_table.relnamespace
            WHERE direct_schema.nspname = 'public'
              AND direct_table.relkind IN ('r', 'p')
              AND (
                has_table_privilege(current_user, direct_table.oid, 'SELECT')
                OR has_table_privilege(current_user, direct_table.oid, 'INSERT')
                OR has_table_privilege(current_user, direct_table.oid, 'UPDATE')
                OR has_table_privilege(current_user, direct_table.oid, 'DELETE')
                OR has_table_privilege(current_user, direct_table.oid, 'TRUNCATE')
                OR has_table_privilege(current_user, direct_table.oid, 'REFERENCES')
                OR has_table_privilege(current_user, direct_table.oid, 'TRIGGER')
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_class AS direct_sequence
            INNER JOIN pg_namespace AS direct_schema
              ON direct_schema.oid = direct_sequence.relnamespace
            WHERE direct_schema.nspname = 'public'
              AND direct_sequence.relkind = 'S'
              AND (
                has_sequence_privilege(current_user, direct_sequence.oid, 'USAGE')
                OR has_sequence_privilege(current_user, direct_sequence.oid, 'SELECT')
                OR has_sequence_privilege(current_user, direct_sequence.oid, 'UPDATE')
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_proc AS other_procedure
            WHERE other_procedure.pronamespace = 'public'::regnamespace
              AND other_procedure.oid NOT IN (
                'public.load_google_execution_permit_v1(uuid)'::regprocedure,
                'public.start_google_execution_permit_v3(uuid,bigint,bigint,bigint,text,text,text,jsonb,text)'::regprocedure,
                'public.fail_google_execution_permit_v1(uuid,bigint,bigint,bigint,text,text,text,text)'::regprocedure,
                'public.complete_google_execution_permit_v1(uuid,text,text,integer)'::regprocedure
              )
              AND has_function_privilege(
                current_user,
                other_procedure.oid,
                'EXECUTE'
              )
          ) AS ready
        FROM pg_proc AS procedure
        WHERE procedure.oid IN (
          'public.load_google_execution_permit_v1(uuid)'::regprocedure,
          'public.start_google_execution_permit_v3(uuid,bigint,bigint,bigint,text,text,text,jsonb,text)'::regprocedure,
          'public.fail_google_execution_permit_v1(uuid,bigint,bigint,bigint,text,text,text,text)'::regprocedure,
          'public.complete_google_execution_permit_v1(uuid,text,text,integer)'::regprocedure
          )
      `)
      return result.rows[0]?.ready === true
    },
  })
}
