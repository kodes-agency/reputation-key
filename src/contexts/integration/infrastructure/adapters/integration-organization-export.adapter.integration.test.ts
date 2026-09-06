import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import type { OrganizationLifecycleContext } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createIntegrationOrganizationExportContributor } from './integration-organization-export.adapter'

const ALL_CONTEXTS = Object.keys(
  CLASSIFICATIONS_BY_CONTEXT,
) as readonly OrganizationLifecycleContext[]

/**
 * Every string here is seeded into a column or a table LIF-01 bullet 7
 * excludes. One byte-scan over the emitted archive is the assertion that
 * matters, so each marker is unique enough that a leak cannot hide inside
 * ordinary lifecycle text.
 */
const MARKERS = Object.freeze({
  accessToken: 'NEVER_EXPORT_ACCESS_TOKEN',
  refreshToken: 'NEVER_EXPORT_REFRESH_TOKEN',
  googleSubject: 'NEVER_EXPORT_GOOGLE_SUBJECT',
  scope: 'https://www.googleapis.com/auth/business.manage',
  providerAccountSuffix: 'NEVER_EXPORT_ACCOUNT_SUFFIX',
  providerLocationSuffix: 'NEVER_EXPORT_LOCATION_SUFFIX',
  googleReviewUri: 'https://never-export.example.test/writereview',
  propertyAddress: 'NEVER_EXPORT_PROVIDER_ADDRESS',
  changeTicket: 'NEVER_EXPORT_CHANGE_TICKET',
  exchangeCiphertext: 'NEVER_EXPORT_EXCHANGE_CIPHERTEXT',
  permitOperationKey: 'NEVER_EXPORT_PERMIT_OPERATION',
  revokeTokenHmac: 'NEVER_EXPORT_REVOKE_TOKEN_HMAC',
  brokerMaterialLocator: 'NEVER_EXPORT_BROKER_MATERIAL',
  cachePayload: 'NEVER_EXPORT_PROVIDER_CACHE',
  credentialBinding: 'ab'.repeat(32),
  replayDigest: 'NeverExportReplayDigest0123456789012345678A',
})

type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  connectionId: string
  sagaId: string
  batchId: string
  revokeAttemptId: string
  permitId: string
  guardId: string
  sourceOperationId: string
  revokePermitId: string
}>

const fixtures: Fixture[] = []
const emptyOrganizations = new Set<string>()
let lease: TestLease
let db: Database

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `integration-export-org-${suffix}`,
    userId: `integration-export-user-${suffix}`,
    memberId: `integration-export-member-${suffix}`,
    propertyId: randomUUID(),
    connectionId: randomUUID(),
    sagaId: randomUUID(),
    batchId: randomUUID(),
    revokeAttemptId: randomUUID(),
    permitId: randomUUID(),
    guardId: randomUUID(),
    sourceOperationId: randomUUID(),
    revokePermitId: randomUUID(),
  }
  fixtures.push(fixture)
  const createdAt = new Date(Date.now() - 60_000)

  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Integration Export Fixture', $1, $2)`,
    [fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Export Manager', $2, true, $3, $3)`,
    [fixture.userId, `${suffix}@example.test`, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [fixture.memberId, fixture.userId, fixture.organizationId, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO google_organization_credential_homes (
       organization_id, authority_generation, home_cell_id,
       catalogue_policy_version, transition_reason, changed_by, change_ticket,
       effective_from
     ) VALUES ($1, 1, 'us', 1, 'new_grant', $2, $3, $4)`,
    [fixture.organizationId, fixture.userId, MARKERS.changeTicket, createdAt],
  )
  await lease.pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       credential_authorized_by, credential_authorized_at, visibility, status,
       credential_home_cell_id, credential_home_policy_version,
       credential_home_authority_generation, last_successful_sync_at,
       status_reason, status_changed_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, ARRAY[$7], $8, $8, $9, 'organization', 'active',
       'us', 1, 1, $9, 'connector_departure_none', $9, $9, $9
     )`,
    [
      fixture.connectionId,
      fixture.organizationId,
      MARKERS.googleSubject,
      MARKERS.accessToken,
      MARKERS.refreshToken,
      new Date(createdAt.getTime() + 3_600_000),
      MARKERS.scope,
      fixture.userId,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Export Property', $3, 'UTC', $4, $4)`,
    [fixture.propertyId, fixture.organizationId, `export-${suffix}`, createdAt],
  )

  await lease.pool.query(
    `INSERT INTO gbp_import_sagas (
       id, organization_id, request_id, initiated_by, total_count, batch_count,
       wire_replay_key_version, wire_replay_digest,
       semantic_replay_key_version, semantic_replay_digest, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 2, 1, 'wire_v1', $5, 'semantic_v1', $5, $6, $6)`,
    [
      fixture.sagaId,
      fixture.organizationId,
      randomUUID(),
      fixture.userId,
      MARKERS.replayDigest,
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO gbp_import_requests (
       id, organization_id, request_id, initiated_by, saga_id, batch_ordinal,
       status, total_count, processed_count, pending_count, processing_count,
       imported_count, wire_replay_key_version, wire_replay_digest,
       semantic_replay_key_version, semantic_replay_digest, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 0, 'processing', 2, 1, 1, 0, 1,
               'wire_v1', $6, 'semantic_v1', $6, $7, $7)`,
    [
      fixture.batchId,
      fixture.organizationId,
      randomUUID(),
      fixture.userId,
      fixture.sagaId,
      MARKERS.replayDigest,
      createdAt,
    ],
  )
  // Per-item rows carry the provider suffixes and the Google review URI; the
  // export must aggregate them into state counts and drop the handles.
  for (const status of ['imported', 'pending'] as const) {
    await lease.pool.query(
      `INSERT INTO gbp_import_request_items (
         id, organization_id, import_job_id, connection_id,
         destination_property_id, provider_account_suffix,
         provider_location_suffix, google_review_uri,
         expected_connection_lifecycle_version, expected_connection_access_version,
         expected_credential_generation, action, update_existing_profile,
         property_name, property_address, country_code, timezone,
         processing_region, routing_policy_version, status, outcome_code,
         first_terminal_at, effect_deadline_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 1, 1, 1, 'create', true,
         'Imported Location', $9, 'US', 'UTC', 'us', 1, $10, $11, $12, $13,
         $14, $14
       )`,
      [
        randomUUID(),
        fixture.organizationId,
        fixture.batchId,
        fixture.connectionId,
        randomUUID(),
        MARKERS.providerAccountSuffix,
        MARKERS.providerLocationSuffix,
        MARKERS.googleReviewUri,
        MARKERS.propertyAddress,
        status,
        status === 'imported' ? 'imported' : null,
        status === 'imported' ? createdAt : null,
        new Date(createdAt.getTime() + 86_400_000),
        createdAt,
      ],
    )
  }

  await lease.pool.query(
    `INSERT INTO google_disconnect_revoke_attempts (
       id, organization_id, connection_id, initiator_user_id, state,
       expected_lifecycle_version, expected_access_version,
       expected_credential_generation, credential_binding, cleanup_deadline_at,
       activated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', 1, 1, 1, $5, $6, $7, $7, $7)`,
    [
      fixture.revokeAttemptId,
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      MARKERS.credentialBinding,
      new Date(createdAt.getTime() + 30_000),
      createdAt,
    ],
  )

  // Rows in tables the export must never open at all.
  await lease.pool.query(
    `INSERT INTO google_oauth_exchange_attempts (
       id, organization_id, initiator_user_id, connection_id, connection_mode,
       state, expected_lifecycle_version, expected_access_version,
       expected_credential_generation, credential_home_cell_id,
       credential_home_policy_version, credential_home_authority_generation,
       encrypted_result, provider_started_at, preserved_at, response_expires_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'new', 'response_preserved', 1, 1, 1, 'us', 1, 1,
               $5, $6, $6, $7, $6, $6)`,
    [
      randomUUID(),
      fixture.organizationId,
      fixture.userId,
      randomUUID(),
      MARKERS.exchangeCiphertext,
      createdAt,
      new Date(createdAt.getTime() + 600_000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, connection_id, initiator_user_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at, created_at
     ) VALUES ($1, 'property.import_gbp_v2', $2, $3, $4, $5, 'route', 'v1',
               'quota', '{}'::jsonb, 'admitted', $6, $7, $6)`,
    [
      fixture.permitId,
      fixture.organizationId,
      fixture.connectionId,
      fixture.userId,
      MARKERS.permitOperationKey,
      createdAt,
      new Date(createdAt.getTime() + 60_000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO google_subject_authority_guards (
       id, project_client_hmac_key_version, project_client_hmac,
       subject_hmac_key_version, subject_hmac, state
     ) VALUES ($1, 'v1', $2, 'v1', $3, 'open')`,
    [fixture.guardId, `project-${suffix}`, `subject-${suffix}`],
  )
  await lease.pool.query(
    `INSERT INTO google_credential_source_operations (
       id, guard_id, source_work_permit_id, organization_id, connection_id,
       sequence, kind, state, expected_lifecycle_version, expected_access_version,
       expected_credential_generation, operation_deadline_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'refresh', 'registered', 1, 1, 1, $6, $7, $7)`,
    [
      fixture.sourceOperationId,
      fixture.guardId,
      fixture.permitId,
      fixture.organizationId,
      fixture.connectionId,
      new Date(Date.now() + 120_000),
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO credential_revoke_permits (
       id, guard_id, source_operation_id, state, token_hmac_key_version,
       token_hmac, cleanup_deadline_at, send_authorization_expires_at,
       activated_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', 'v1', $4, $5, $5, $6, $6, $6)`,
    [
      fixture.revokePermitId,
      fixture.guardId,
      fixture.sourceOperationId,
      MARKERS.revokeTokenHmac,
      new Date(createdAt.getTime() + 60_000),
      createdAt,
    ],
  )
  await lease.pool.query(
    `INSERT INTO google_credential_broker_replay (
       organization_id, lookup_key_version, grant_id_hmac, one_use_nonce_hmac,
       connection_id, property_id, home_cell_id, target_cell_id,
       target_gateway_identity, route_key, credential_home_authority_generation,
       connection_lifecycle_version, connection_access_version,
       credential_generation, property_source_epoch, request_digest_sha256,
       credential_binding_sha256, routing_directory_revision,
       routing_policy_version, material_locator, material_encryption_key_id,
       material_binding_sha256, issued_at, expires_at, state
     ) VALUES ($1, 'broker_v1', $2, $3, $4, $5, 'us', 'europe', 'gateway',
               'route', 1, 1, 1, 1, 0, $6, $6, 1, 1, $7, 'key-1', $6, $8, $9,
               'issued')`,
    [
      fixture.organizationId,
      'A'.repeat(43),
      'B'.repeat(43),
      fixture.connectionId,
      fixture.propertyId,
      'd'.repeat(64),
      MARKERS.brokerMaterialLocator,
      createdAt,
      new Date(createdAt.getTime() + 60_000),
    ],
  )
  return fixture
}

const ORGANIZATION_SCOPED_TABLES = [
  'google_credential_broker_replay',
  'google_oauth_exchange_attempts',
  'google_disconnect_revoke_attempts',
  'gbp_import_request_items',
  'gbp_import_requests',
  'gbp_import_sagas',
  'properties',
  'google_connections',
  'google_organization_credential_homes',
] as const

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await lease.pool.query('DELETE FROM credential_revoke_permits WHERE id = $1', [
    fixture.revokePermitId,
  ])
  await lease.pool.query(
    'DELETE FROM google_credential_source_operations WHERE id = $1',
    [fixture.sourceOperationId],
  )
  await lease.pool.query('DELETE FROM google_subject_authority_guards WHERE id = $1', [
    fixture.guardId,
  ])
  for (const table of ORGANIZATION_SCOPED_TABLES) {
    // Table names are hardcoded above, never caller-supplied.
    await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      fixture.organizationId,
    ])
  }
  await lease.pool.query('DELETE FROM authorization_execution_permits WHERE id = $1', [
    fixture.permitId,
  ])
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${fixture.organizationId}`,
  ])
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await lease.pool.query('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

const archiveText = (entries: readonly { bytes: Uint8Array }[]) =>
  entries.map(({ bytes }) => Buffer.from(bytes).toString('utf8')).join('\n')

describe.sequential('Integration Organization Export contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const fixture of fixtures) await cleanupFixture(fixture)
    fixtures.length = 0
    await deleteTestOrganizations(lease.pool, [...emptyOrganizations])
    emptyOrganizations.clear()
  })

  it('exports deterministic content-free Google lifecycle status', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createIntegrationOrganizationExportContributor(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'integration',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(
      first.entries.map(({ path, mediaType, classification }) => ({
        path,
        mediaType,
        classification,
      })),
    ).toEqual([
      {
        path: 'integration/google-lifecycle.csv',
        mediaType: 'text/csv',
        classification: 'content_free_lifecycle',
      },
      {
        path: 'integration/google-lifecycle.json',
        mediaType: 'application/json',
        classification: 'content_free_lifecycle',
      },
    ])

    const json = first.entries.find(({ mediaType }) => mediaType === 'application/json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({
      version: 'integration-organization-export/v1',
      googleConnections: [
        {
          id: fixture.connectionId,
          status: 'active',
          visibility: 'organization',
          credential_use_state: 'active',
          credential_home_cell_id: 'us',
          connected_by: fixture.userId,
        },
      ],
      credentialHomeAuthority: [
        { authority_generation: 1, home_cell_id: 'us', transition_reason: 'new_grant' },
      ],
      importSagas: [{ id: fixture.sagaId, total_count: 2, batch_count: 1 }],
      importBatches: [
        { id: fixture.batchId, status: 'processing', imported_count: 1, total_count: 2 },
      ],
      disconnectCleanupAttempts: [
        {
          id: fixture.revokeAttemptId,
          state: 'active',
          connection_id: fixture.connectionId,
        },
      ],
    })
    // The item plane arrives as counts by state, never as per-location rows.
    expect(payload.importItemStateCounts).toEqual([
      {
        import_job_id: fixture.batchId,
        status: 'imported',
        action: 'create',
        outcome_code: 'imported',
        item_count: 1,
        first_created_at: expect.any(String),
        last_updated_at: expect.any(String),
      },
      {
        import_job_id: fixture.batchId,
        status: 'pending',
        action: 'create',
        outcome_code: null,
        item_count: 1,
        first_created_at: expect.any(String),
        last_updated_at: expect.any(String),
      },
    ])
  })

  it('leaks no credential, provider identifier or excluded control-plane value', async () => {
    const fixture = await seedFixture()
    const contributor = createIntegrationOrganizationExportContributor(db)

    const contribution = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const archive = archiveText(contribution.entries)

    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(`${name}:${archive.includes(marker) ? 'leaked' : 'withheld'}`).toBe(
        `${name}:withheld`,
      )
    }
    // Field names that would betray the same material even without a value.
    expect(archive).not.toMatch(
      /encrypted_access_token|encrypted_refresh_token|encryption_key_id|token_expires_at/u,
    )
    expect(archive).not.toMatch(
      /provider_account_suffix|provider_location_suffix|google_review_uri|property_address/u,
    )
    expect(archive).not.toMatch(
      /wire_replay_digest|semantic_replay_digest|cleanup_work_permit_id|changed_by|change_ticket/u,
    )

    const payload = JSON.parse(
      Buffer.from(
        contribution.entries.find(({ mediaType }) => mediaType === 'application/json')!
          .bytes,
      ).toString('utf8'),
    ) as { excludedRecordClasses: readonly { recordClass: string }[] }
    expect(payload.excludedRecordClasses.map(({ recordClass }) => recordClass)).toEqual(
      expect.arrayContaining([
        'google_oauth_credentials',
        'google_oauth_exchange_attempts',
        'provider_execution_and_revoke_permits',
        'google_credential_broker_and_routing_directory',
        'google_provider_account_and_location_identifiers',
        'legacy_gbp_provider_cache',
        'google_business_profile_performance_reports',
      ]),
    )
  })

  it('answers no_data for an Organization that never connected Google', async () => {
    const organizationId = `integration-export-empty-${randomUUID()}`
    emptyOrganizations.add(organizationId)
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Integration Export Empty', $1, now())`,
      [organizationId],
    )

    const contribution = await createIntegrationOrganizationExportContributor(
      db,
    ).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'integration',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const fixture = await seedFixture()
    const contributor = createIntegrationOrganizationExportContributor(db)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
      contributors: ALL_CONTEXTS.map((context) =>
        context === 'integration'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'integration/google-lifecycle.csv',
        'integration/google-lifecycle.json',
        'coverage.json',
        'manifest.json',
      ]),
    )
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createIntegrationOrganizationExportContributor(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
