import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from '../../application/google-provider-contract'

/** Tenant markers that must be gone (or never emitted) after each phase. */
export const MARKERS = Object.freeze({
  accessToken: 'CLOSURE_ACCESS_TOKEN',
  refreshToken: 'CLOSURE_REFRESH_TOKEN',
  googleSubject: 'CLOSURE_GOOGLE_SUBJECT',
  // The schema pins replay digests to exactly 43 URL-safe base64 characters.
  replayDigest: `ClosureReplayDigest${'0'.repeat(24)}`,
})

export type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  connectionId: string
  importId: string
  permitId: string
}>

export const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')

async function seedSingleRootImport(pool: Pool, fixture: Fixture): Promise<void> {
  await pool.query(
    `INSERT INTO google_imports (
       id, organization_id, request_id, initiated_by, total_count,
       wire_replay_key_version, wire_replay_digest,
       semantic_replay_key_version, semantic_replay_digest, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 2, 'wire_v1', $5, 'semantic_v1', $5, $6, $6)`,
    [
      fixture.importId,
      fixture.organizationId,
      randomUUID(),
      fixture.userId,
      MARKERS.replayDigest,
      CREATED_AT,
    ],
  )
  await pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, connection_id,
       destination_property_id, provider_account_suffix, provider_location_suffix,
       expected_connection_lifecycle_version, expected_connection_access_version,
       expected_credential_generation, expected_execution_policy_version,
       expected_actor_role, expected_permission_digest, expected_principal_kind,
       expected_permission_version, action, update_existing_profile,
       property_name, country_code, timezone, status, next_dispatch_at,
       effect_deadline_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'account-suffix', 'location-suffix', 1, 1, 1,
       'beta-local-2', 'AccountAdmin', repeat('a', 64), 'user', 1,
       'create', true, 'Imported Location', 'US', 'UTC', 'pending', $6,
       $7, $6, $6
     )`,
    [
      randomUUID(),
      fixture.organizationId,
      fixture.importId,
      fixture.connectionId,
      randomUUID(),
      CREATED_AT,
      new Date(CREATED_AT.getTime() + 86_400_000),
    ],
  )
  await pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, destination_property_id, action,
       update_existing_profile, property_name, country_code, timezone, status,
       outcome_code, first_terminal_at, effect_deadline_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 'create', true, 'Imported Location', 'US', 'UTC',
       'imported', 'imported', $5, $6, $5, $5
     )`,
    [
      randomUUID(),
      fixture.organizationId,
      fixture.importId,
      fixture.propertyId,
      CREATED_AT,
      new Date(CREATED_AT.getTime() + 86_400_000),
    ],
  )
}

export async function seedIntegrationLifecycleFixture(pool: Pool): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `integration-lifecycle-org-${suffix}`,
    userId: `integration-lifecycle-user-${suffix}`,
    memberId: `integration-lifecycle-member-${suffix}`,
    propertyId: randomUUID(),
    connectionId: randomUUID(),
    importId: randomUUID(),
    permitId: randomUUID(),
  }

  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Integration lifecycle fixture', $1, $2)`,
    [fixture.organizationId, CREATED_AT],
  )
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Closure Manager', $2, true, $3, $3)`,
    [fixture.userId, `${suffix}@example.test`, CREATED_AT],
  )
  await pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [fixture.memberId, fixture.userId, fixture.organizationId, CREATED_AT],
  )
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       credential_authorized_by, credential_authorized_at, visibility, status,
       credential_use_state, last_successful_sync_at, status_reason, status_changed_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, ARRAY[$9]::text[],
       $7, $7, $8, 'organization', 'active', 'active', $8,
       'connected', $8, $8, $8
     )`,
    [
      fixture.connectionId,
      fixture.organizationId,
      `${MARKERS.googleSubject}-${suffix}`,
      MARKERS.accessToken,
      MARKERS.refreshToken,
      new Date(CREATED_AT.getTime() + 3_600_000),
      fixture.userId,
      CREATED_AT,
      GOOGLE_BUSINESS_MANAGE_SCOPE,
    ],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Closure Property', $3, 'UTC', $4, $4)`,
    [fixture.propertyId, fixture.organizationId, `closure-${suffix}`, CREATED_AT],
  )
  await seedSingleRootImport(pool, fixture)
  await pool.query(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('google_disconnect_revoke', $1, jsonb_build_object(
       'id', $1::text,
       'organizationId', $2::text,
       'connectionId', $3::text,
       'initiatorUserId', $4::text,
       'state', 'confirmed_revoked',
       'expectedLifecycleVersion', 1,
       'expectedAccessVersion', 1,
       'expectedCredentialGeneration', 1,
       'credentialBinding', NULL,
       'cleanupDeadlineAt', $5::timestamptz,
       'activatedAt', $6::timestamptz,
       'terminalAt', $6::timestamptz,
       'outcomeCode', 'google_revoke_confirmed',
       'updatedAt', $6::timestamptz
     ), $6)`,
    [
      randomUUID(),
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      new Date(CREATED_AT.getTime() + 30_000),
      CREATED_AT,
    ],
  )
  await pool.query(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('google_oauth_exchange', $1, jsonb_build_object(
       'id', $1::text,
       'organizationId', $2::text,
       'initiatorUserId', $3::text,
       'connectionId', $4::text,
       'state', 'completed',
       'terminalAt', $5::timestamptz,
       'outcomeCode', 'connected',
       'updatedAt', $5::timestamptz
     ), $5)`,
    [randomUUID(), fixture.organizationId, fixture.userId, randomUUID(), CREATED_AT],
  )
  await pool.query(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, connection_id, initiator_user_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at,
       started_at, operation_deadline_at, completed_at, correlation_id, created_at
     ) VALUES ($1, 'property.import_gbp_v2', $2, $3, $4, 'operation', 'route',
               'v1', 'quota', '{}'::jsonb, 'completed', $5, $6, $6, $7, $7,
               'correlation', $5)`,
    [
      fixture.permitId,
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      CREATED_AT,
      new Date(CREATED_AT.getTime() + 60_000),
      new Date(CREATED_AT.getTime() + 120_000),
    ],
  )
  return fixture
}
