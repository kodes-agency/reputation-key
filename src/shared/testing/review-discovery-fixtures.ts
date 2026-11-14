// Real-PostgreSQL fixtures for the review discovery sweep and sync job tests.
//
// A fixture is plain data about one Property (its binding, its Google
// connection, its review_sync_state row, its newest completed reconciliation
// and whether a GBP import is in flight). `seed` writes it through SQL and the
// job tests run the real ReviewDiscoveryRepository against it; `read` returns
// what the repository stored. Call `setupDiscoveryDb()` once per test file.

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type { ReviewDiscoveryRepository } from '#/contexts/review/application/ports/review-discovery.repository'
import { deleteTestOrganizationsWithExecutor } from '#/shared/db/testing/test-organization-cleanup'

/** The Organization every discovery fixture belongs to. */
export const DISCOVERY_ORG = 'org-review-discovery-jobs-1111111111'

/** Properties are observed long before any test clock, so they start cold. */
const LONG_OBSERVED = new Date('2020-01-01T00:00:00.000Z')

export type DiscoveryPropertyFixture = {
  propertyId: string
  organizationId: string
  connectionId: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  /** 'unbound' | 'account_confirmation_required' | 'active' | 'disconnected' */
  googleBindingState: string
  /** 'active' | 'suspended' | 'archived' | … */
  lifecycleState: string
  deletedAt: Date | null
  /** google_connections.status */
  connectionStatus: string
  /** google_connections.credential_use_state */
  credentialUseState: string
  /** review_sync_state.next_incremental_at — null = never polled. */
  nextDueAt: Date | null
  errorClass: string | null
  errorRetryAt: Date | null
  /** review_sync_state.last_terminal_error_at */
  lastFailureAt: Date | null
  lastSuccessAt: Date | null
  lastNewReviewAt: Date | null
  lastNotificationAt: Date | null
  /** properties.created_at — the ladder's activity floor. */
  observedSince: Date
  /** evaluated_at of a completed reconciliation of the Property's current epoch. */
  lastReconciledAt: Date | null
  headCoveredAt: Date | null
  fullReadRequestedAt: Date | null
  /** A pending GBP import item targets this Property. */
  importInFlight: boolean
}

export type DiscoveryState = Pick<
  DiscoveryPropertyFixture,
  | 'nextDueAt'
  | 'errorClass'
  | 'errorRetryAt'
  | 'lastFailureAt'
  | 'lastSuccessAt'
  | 'fullReadRequestedAt'
>

/** A connected, active, never-polled Property — the discovery happy path. */
export const discoveryProperty = (
  overrides: Partial<DiscoveryPropertyFixture> = {},
): DiscoveryPropertyFixture => ({
  propertyId: 'aa000000-0000-4000-8000-000000000001',
  organizationId: DISCOVERY_ORG,
  connectionId: 'bb000000-0000-4000-8000-000000000001',
  gbpAccountId: '1234567890',
  gbpLocationId: '9876543210',
  googleBindingState: 'active',
  lifecycleState: 'active',
  deletedAt: null,
  connectionStatus: 'active',
  credentialUseState: 'active',
  nextDueAt: null,
  errorClass: null,
  errorRetryAt: null,
  lastFailureAt: null,
  lastSuccessAt: null,
  lastNewReviewAt: null,
  lastNotificationAt: null,
  observedSince: LONG_OBSERVED,
  lastReconciledAt: null,
  headCoveredAt: null,
  fullReadRequestedAt: null,
  importInFlight: false,
  ...overrides,
})

const hasSyncState = (row: DiscoveryPropertyFixture): boolean =>
  [
    row.nextDueAt,
    row.errorClass,
    row.errorRetryAt,
    row.lastFailureAt,
    row.lastSuccessAt,
    row.lastNewReviewAt,
    row.lastNotificationAt,
    row.headCoveredAt,
    row.fullReadRequestedAt,
  ].some((value) => value !== null)

async function seedConnections(
  pool: Pool,
  rows: readonly DiscoveryPropertyFixture[],
): Promise<void> {
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.connectionId === null || seen.has(row.connectionId)) continue
    seen.add(row.connectionId)
    await pool.query(
      `INSERT INTO google_connections
         (id, organization_id, google_subject, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, scopes, connected_by,
          visibility, status, credential_use_state, created_at, updated_at)
       VALUES ($1, $2, $3, 'enc-a', 'enc-r', NOW() + INTERVAL '1 day',
               ARRAY['https://www.googleapis.com/auth/business.manage'],
               'seed-user', 'organization', $4, $5, NOW(), NOW())`,
      [
        row.connectionId,
        row.organizationId,
        `subject-${row.connectionId}`,
        row.connectionStatus,
        row.credentialUseState,
      ],
    )
  }
}

async function seedProperty(pool: Pool, row: DiscoveryPropertyFixture): Promise<void> {
  // The binding CHECK constraint leaves the provider columns empty unless the
  // Property is (or was) bound.
  const bound =
    row.googleBindingState === 'active' || row.googleBindingState === 'disconnected'
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, google_connection_id,
        gbp_account_id, gbp_location_id, google_binding_state, lifecycle_state,
        deleted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      row.propertyId,
      row.organizationId,
      `Discovery ${row.propertyId.slice(-4)}`,
      `discovery-${row.propertyId}`,
      bound ? row.connectionId : null,
      bound ? row.gbpAccountId : null,
      bound ? row.gbpLocationId : null,
      row.googleBindingState,
      row.lifecycleState,
      row.deletedAt,
      row.observedSince,
    ],
  )
}

async function seedSyncState(pool: Pool, row: DiscoveryPropertyFixture): Promise<void> {
  if (!hasSyncState(row)) return
  await pool.query(
    `INSERT INTO review_sync_state
       (property_id, source, next_incremental_at, error_class, error_retry_at,
        last_terminal_error_at, last_success_at, last_new_review_at,
        last_notification_at, head_covered_at, full_read_requested_at)
     VALUES ($1, 'google', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.propertyId,
      row.nextDueAt,
      row.errorClass,
      row.errorRetryAt,
      row.lastFailureAt,
      row.lastSuccessAt,
      row.lastNewReviewAt,
      row.lastNotificationAt,
      row.headCoveredAt,
      row.fullReadRequestedAt,
    ],
  )
}

async function seedReconciliation(
  pool: Pool,
  row: DiscoveryPropertyFixture,
): Promise<void> {
  if (row.lastReconciledAt === null) return
  await pool.query(
    `INSERT INTO review_google_reputation_snapshot_facts
       (run_id, event_id, organization_id, property_id, source_epoch,
        review_count, average_rating, evaluated_at, listing_complete)
     VALUES ($1, $2, $3, $4, 0, 3, 4.5, $5, true)`,
    [
      randomUUID(),
      randomUUID(),
      row.organizationId,
      row.propertyId,
      row.lastReconciledAt,
    ],
  )
}

/**
 * A pending relink item targets the Property. The import tables' CHECK
 * constraints pin the whole shape, so this is the minimum row pair Postgres
 * accepts for an unsettled item.
 */
async function seedImportInFlight(
  pool: Pool,
  row: DiscoveryPropertyFixture,
): Promise<void> {
  if (!row.importInFlight || row.connectionId === null) return
  const importId = randomUUID()
  await pool.query(
    `INSERT INTO google_imports
       (id, organization_id, request_id, initiated_by, total_count,
        wire_replay_key_version, wire_replay_digest,
        semantic_replay_key_version, semantic_replay_digest,
        created_at, updated_at)
     VALUES ($1, $2, $1, 'seed-user', 1, 'v1', $3, 'v1', $4, NOW(), NOW())`,
    [importId, row.organizationId, 'A'.repeat(43), 'B'.repeat(43)],
  )
  await pool.query(
    `INSERT INTO google_import_items
       (id, organization_id, import_id, connection_id, existing_property_id,
        destination_property_id, provider_account_suffix, provider_location_suffix,
        expected_connection_lifecycle_version, expected_connection_access_version,
        expected_credential_generation, expected_execution_policy_version,
        expected_actor_role, expected_permission_digest, expected_principal_kind,
        expected_permission_version, expected_source_epoch, expected_profile_version,
        action, update_existing_profile, property_name, timezone, status,
        highest_attempt_for_revision, next_dispatch_at, effect_deadline_at,
        created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $4, $5, $6, 1, 1, 1, 'beta-local-2',
             'AccountAdmin', repeat('a', 64), 'user', 1, 0, 1,
             'relink', false, 'Importing Property', 'UTC', 'pending', 0,
             NOW(), NOW() + INTERVAL '24 hours', NOW(), NOW())`,
    [
      row.organizationId,
      importId,
      row.connectionId,
      row.propertyId,
      row.gbpAccountId,
      row.gbpLocationId,
    ],
  )
}

async function clearDiscoveryRows(
  pool: Pool,
  organizationIds: readonly string[],
): Promise<void> {
  await pool.query(
    `DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ANY($1)`,
    [organizationIds],
  )
  await pool.query(
    `DELETE FROM review_sync_state
      WHERE property_id IN (SELECT id::text FROM properties WHERE organization_id = ANY($1))`,
    [organizationIds],
  )
  // Import items hold restrict-on-delete FKs to Properties and connections,
  // so their import goes first.
  await pool.query(`DELETE FROM google_imports WHERE organization_id = ANY($1)`, [
    organizationIds,
  ])
  await pool.query(`DELETE FROM properties WHERE organization_id = ANY($1)`, [
    organizationIds,
  ])
  await pool.query(`DELETE FROM google_connections WHERE organization_id = ANY($1)`, [
    organizationIds,
  ])
}

export type DiscoveryDb = Readonly<{
  /** Write the fixtures (and their connections) before a handler runs. */
  seed: (rows: readonly DiscoveryPropertyFixture[]) => Promise<void>
  /** What the repository stored for a Property: null fields when it has no row. */
  read: (propertyId: string) => Promise<DiscoveryState>
  /** Change a seeded connection's status, as a reconnect or a revoke would. */
  setConnectionStatus: (connectionId: string, status: string) => Promise<void>
  /** Remove every fixture, so the same Property can be seeded afresh in one test. */
  reset: () => Promise<void>
  /** The import targeting the Property reaches a terminal state. */
  settleImport: (propertyId: string) => Promise<void>
  /** Forget the stored due time, as if the Property were never polled. */
  clearDueTime: (propertyId: string) => Promise<void>
  /** The real repository over the test database. */
  repo: () => ReviewDiscoveryRepository
}>

/** Registers the lease and per-test cleanup hooks; call once per test file. */
export function setupDiscoveryDb(
  createRepository: (db: ReturnType<typeof getDb>) => ReviewDiscoveryRepository,
): DiscoveryDb {
  let leased: Pool | undefined
  // A test may hand the same fixture to several handlers; it is written once.
  const seeded = new Set<string>()
  const pool = (): Pool => {
    if (!leased) throw new Error('Discovery test database is not open yet')
    return leased
  }

  beforeAll(async () => {
    leased = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
    await clearDiscoveryRows(leased, [DISCOVERY_ORG])
    await leased.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Discovery job tests', $1, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [DISCOVERY_ORG],
    )
  })

  afterEach(async () => {
    seeded.clear()
    await clearDiscoveryRows(pool(), [DISCOVERY_ORG])
  })

  afterAll(async () => {
    try {
      if (leased) {
        await clearDiscoveryRows(leased, [DISCOVERY_ORG])
        await deleteTestOrganizationsWithExecutor(leased, [DISCOVERY_ORG])
      }
    } finally {
      await leased?.end()
    }
  })

  return {
    seed: async (requested) => {
      const rows = requested.filter((row) => !seeded.has(row.propertyId))
      for (const row of rows) seeded.add(row.propertyId)
      await seedConnections(pool(), rows)
      for (const row of rows) {
        await seedProperty(pool(), row)
        await seedSyncState(pool(), row)
        await seedReconciliation(pool(), row)
        await seedImportInFlight(pool(), row)
      }
    },
    read: async (propertyId) => {
      const { rows } = await pool().query(
        `SELECT next_incremental_at, error_class, error_retry_at,
                last_terminal_error_at, last_success_at, full_read_requested_at
           FROM review_sync_state
          WHERE property_id = $1 AND source = 'google'`,
        [propertyId],
      )
      const row = rows.at(0)
      return {
        nextDueAt: row?.next_incremental_at ?? null,
        errorClass: row?.error_class ?? null,
        errorRetryAt: row?.error_retry_at ?? null,
        lastFailureAt: row?.last_terminal_error_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
        fullReadRequestedAt: row?.full_read_requested_at ?? null,
      }
    },
    setConnectionStatus: async (connectionId, status) => {
      await pool().query(`UPDATE google_connections SET status = $2 WHERE id = $1`, [
        connectionId,
        status,
      ])
    },
    reset: async () => {
      seeded.clear()
      await clearDiscoveryRows(pool(), [DISCOVERY_ORG])
    },
    settleImport: async (propertyId) => {
      const { rows } = await pool().query(
        `UPDATE google_import_items
            SET status = 'relinked', outcome_code = 'relinked', first_terminal_at = NOW(),
                existing_property_id = NULL, destination_property_id = NULL,
                connection_id = NULL, provider_account_suffix = NULL,
                provider_location_suffix = NULL,
                expected_connection_lifecycle_version = NULL,
                expected_connection_access_version = NULL,
                expected_credential_generation = NULL,
                expected_execution_policy_version = NULL, expected_actor_role = NULL,
                expected_permission_digest = NULL, expected_principal_kind = NULL,
                expected_permission_version = NULL,
                expected_source_epoch = NULL, expected_profile_version = NULL,
                claim_fence = NULL, claim_lease_expires_at = NULL, next_dispatch_at = NULL
          WHERE existing_property_id = $1
        RETURNING import_id`,
        [propertyId],
      )
      await pool().query(
        `UPDATE google_imports
            SET first_terminal_at = NOW(), purge_at = NOW() + INTERVAL '30 days'
          WHERE id = ANY($1)`,
        [rows.map((row) => row.import_id)],
      )
    },
    clearDueTime: async (propertyId) => {
      await pool().query(
        `UPDATE review_sync_state SET next_incremental_at = NULL
          WHERE property_id = $1 AND source = 'google'`,
        [propertyId],
      )
    },
    repo: () => createRepository(getDb()),
  }
}
