// Review context — new-review discovery repository integration tests.
//
// Proves the real SQL predicate against Postgres: only Google-CONNECTED,
// active, non-deleted properties are candidates (regardless of whether they
// have any stored review — the gap the refresh sweep cannot cover), due-time
// filtering uses review_sync_state.next_incremental_at, the keyset cursor
// pages without skipping or repeating, and the scheduled/deferred marks
// round-trip.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createReviewDiscoveryRepository } from './review-discovery.repository'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'

// Provider resource literals may only live in the generated fixture catalogue
// (scripts/check-google-provider-identifiers.mjs). These synthetic segments are
// the sanctioned source; a hand-written `accounts/…/locations/…` in a test file
// fails `pnpm lint`.
const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments

const ORG = 'org-discovery-test-1111111111111111'
const CONN_ACTIVE = 'c1000000-0000-4000-8000-000000000001'
const CONN_REAUTH = 'c1000000-0000-4000-8000-000000000002'

const PROP_CONNECTED = 'd1000000-0000-4000-8000-000000000001'
const PROP_CONNECTED_2 = 'd1000000-0000-4000-8000-000000000002'
const PROP_UNBOUND = 'd1000000-0000-4000-8000-000000000003'
const PROP_DELETED = 'd1000000-0000-4000-8000-000000000004'
const PROP_SUSPENDED = 'd1000000-0000-4000-8000-000000000005'
const PROP_REAUTH_CONN = 'd1000000-0000-4000-8000-000000000006'

const ALL_PROPS = [
  PROP_CONNECTED,
  PROP_CONNECTED_2,
  PROP_UNBOUND,
  PROP_DELETED,
  PROP_SUSPENDED,
  PROP_REAUTH_CONN,
]

const IMPORT_REQUEST = 'e1000000-0000-4000-8000-000000000001'
const IMPORT_ITEM = 'e1000000-0000-4000-8000-000000000002'

const NOW = new Date('2026-08-21T12:00:00.000Z')

let pool: Pool
const db = getDb()

async function seedConnection(id: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO google_connections
       (id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status, credential_use_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'enc-a', 'enc-r', NOW() + INTERVAL '1 day',
             ARRAY['https://www.googleapis.com/auth/business.manage'],
             'seed-user', 'organization', $4, 'active', NOW(), NOW())`,
    [id, ORG, `subject-${id}`, status],
  )
}

type SeedProperty = Readonly<{
  id: string
  connectionId: string | null
  bindingState: string
  lifecycleState?: string
  deleted?: boolean
}>

async function seedProperty(p: SeedProperty): Promise<void> {
  const bound = p.bindingState === 'active' || p.bindingState === 'disconnected'
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, google_connection_id,
        gbp_account_id, gbp_location_id, google_binding_state, lifecycle_state,
        deleted_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'UTC', $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
    [
      p.id,
      ORG,
      `Discovery ${p.id.slice(-2)}`,
      `discovery-${p.id.slice(-2)}`,
      p.connectionId,
      bound ? GBP_ACCOUNT_ID : null,
      bound ? `${GBP_LOCATION_ID}-${p.id.slice(-2)}` : null,
      p.bindingState,
      p.lifecycleState ?? 'active',
      p.deleted ? NOW.toISOString() : null,
    ],
  )
}

/**
 * Seed a GBP import whose single relink item targets `targetPropertyId`. The
 * table's CHECK constraints pin the whole shape (deadline = created_at + 24h,
 * routing retention on pending items, counts arithmetic, terminal-time
 * pairing), so this is the minimum row pair Postgres accepts.
 *
 * A terminal parent status needs its terminal timestamps; that combination —
 * a settled parent with a leftover `pending` item — is what proves the
 * exclusion requires BOTH rows to be in flight.
 */
async function seedImport(
  targetPropertyId: string,
  statuses: Readonly<{ parent: string; item: string }>,
): Promise<void> {
  const parentInFlight = statuses.parent === 'queued' || statuses.parent === 'processing'
  await pool.query(
    `INSERT INTO gbp_import_requests
       (id, organization_id, request_id, initiated_by, status, total_count,
        processed_count, pending_count, processing_count,
        first_terminal_at, purge_at, created_at, updated_at)
     VALUES ($1, $2, $1, 'seed-user', $3, 1, 0, 1, 0,
             CASE WHEN $4::boolean THEN NULL ELSE NOW() END,
             CASE WHEN $4::boolean THEN NULL ELSE NOW() + INTERVAL '30 days' END,
             NOW(), NOW())`,
    [IMPORT_REQUEST, ORG, statuses.parent, parentInFlight],
  )
  await pool.query(
    `INSERT INTO gbp_import_request_items
       (id, organization_id, import_job_id, connection_id, existing_property_id,
        destination_property_id, provider_account_suffix, provider_location_suffix,
        expected_connection_lifecycle_version, expected_connection_access_version,
        expected_credential_generation, expected_source_epoch, expected_profile_version,
        action, update_existing_profile, property_name, timezone, processing_region,
        routing_policy_version, status, effect_deadline_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 1, 1, 1, 0, 1,
             'relink', false, 'Importing Property', 'UTC', 'global', 1, $8,
             NOW() + INTERVAL '24 hours', NOW(), NOW())`,
    [
      IMPORT_ITEM,
      ORG,
      IMPORT_REQUEST,
      CONN_ACTIVE,
      targetPropertyId,
      GBP_ACCOUNT_ID,
      GBP_LOCATION_ID,
      statuses.item,
    ],
  )
}

async function settleImport(): Promise<void> {
  await pool.query(
    `UPDATE gbp_import_request_items
        SET status = 'relinked', outcome_code = 'relinked', first_terminal_at = NOW(),
            existing_property_id = NULL, destination_property_id = NULL,
            expected_connection_lifecycle_version = NULL,
            expected_connection_access_version = NULL,
            expected_credential_generation = NULL,
            expected_source_epoch = NULL, expected_profile_version = NULL
      WHERE id = $1`,
    [IMPORT_ITEM],
  )
  await pool.query(
    `UPDATE gbp_import_requests
        SET status = 'completed', pending_count = 0, processed_count = 1,
            relinked_count = 1, first_terminal_at = NOW(),
            purge_at = NOW() + INTERVAL '30 days'
      WHERE id = $1`,
    [IMPORT_REQUEST],
  )
}

async function clearSeed(): Promise<void> {
  await pool.query(`DELETE FROM review_sync_state WHERE property_id = ANY($1)`, [
    ALL_PROPS,
  ])
  // Import items hold restrict-on-delete FKs to properties and connections,
  // so they must go first.
  await pool.query(`DELETE FROM gbp_import_request_items WHERE organization_id = $1`, [
    ORG,
  ])
  await pool.query(`DELETE FROM gbp_import_requests WHERE organization_id = $1`, [ORG])
  await pool.query(`DELETE FROM properties WHERE organization_id = $1`, [ORG])
  await pool.query(`DELETE FROM google_connections WHERE organization_id = $1`, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Discovery Test Org', 'discovery-test-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
})

afterAll(async () => {
  await clearSeed()
  await pool.query(`DELETE FROM organization WHERE id = $1`, [ORG])
  await pool.end()
})

beforeEach(async () => {
  await clearSeed()
  await seedConnection(CONN_ACTIVE, 'active')
  await seedConnection(CONN_REAUTH, 'reauth_required')
  await seedProperty({
    id: PROP_CONNECTED,
    connectionId: CONN_ACTIVE,
    bindingState: 'active',
  })
  await seedProperty({
    id: PROP_CONNECTED_2,
    connectionId: CONN_ACTIVE,
    bindingState: 'active',
  })
  await seedProperty({ id: PROP_UNBOUND, connectionId: null, bindingState: 'unbound' })
  await seedProperty({
    id: PROP_DELETED,
    connectionId: CONN_ACTIVE,
    bindingState: 'active',
    deleted: true,
  })
  await seedProperty({
    id: PROP_SUSPENDED,
    connectionId: CONN_ACTIVE,
    bindingState: 'active',
    lifecycleState: 'suspended',
  })
  await seedProperty({
    id: PROP_REAUTH_CONN,
    connectionId: CONN_REAUTH,
    bindingState: 'active',
  })
})

/**
 * The sweep is deliberately tenant-cross, so the shared integration database
 * contributes candidates from other suites' fixtures. Assertions narrow to
 * this suite's seeded properties; `PAGE` stays above the whole-table count so
 * narrowing never hides a paging bug.
 */
const PAGE = 500
const mine = (
  candidates: readonly Readonly<{ propertyId: string }>[],
): readonly string[] =>
  candidates.map((c) => c.propertyId).filter((id) => ALL_PROPS.includes(id))

describe('reviewDiscoveryRepository (integration)', () => {
  it('returns only connected, active, non-deleted properties with a usable connection', async () => {
    const repo = createReviewDiscoveryRepository(db)

    const due = await repo.findDuePropertiesBatch(NOW, null, PAGE)

    expect(mine(due)).toEqual([PROP_CONNECTED, PROP_CONNECTED_2])
    expect(due.find((c) => c.propertyId === PROP_CONNECTED)).toEqual({
      propertyId: PROP_CONNECTED,
      organizationId: ORG,
      connectionId: CONN_ACTIVE,
      locationName: `accounts/${GBP_ACCOUNT_ID}/locations/${GBP_LOCATION_ID}-01`,
      activity: {
        lastNewReviewAt: null,
        lastNotificationAt: null,
        observedSince: expect.any(Date),
      },
    })
  })

  it('includes a connected property that has never been polled and has no stored reviews', async () => {
    const repo = createReviewDiscoveryRepository(db)
    const stored = await pool.query(
      `SELECT count(*)::int AS n FROM reviews WHERE property_id = $1`,
      [PROP_CONNECTED],
    )
    expect(stored.rows[0].n).toBe(0)

    const due = await repo.findDuePropertiesBatch(NOW, null, PAGE)

    expect(mine(due)).toContain(PROP_CONNECTED)
  })

  it('excludes a property whose next poll has not elapsed and re-includes it once due', async () => {
    const repo = createReviewDiscoveryRepository(db)
    const nextDueAt = new Date(NOW.getTime() + 15 * 60 * 1000)

    await repo.markDiscoveryScheduled(PROP_CONNECTED, NOW, nextDueAt)

    const stillDue = await repo.findDuePropertiesBatch(NOW, null, PAGE)
    expect(mine(stillDue)).toEqual([PROP_CONNECTED_2])

    const laterDue = await repo.findDuePropertiesBatch(nextDueAt, null, PAGE)
    expect(mine(laterDue)).toEqual([PROP_CONNECTED, PROP_CONNECTED_2])
  })

  it('pages with a keyset cursor without skipping or repeating', async () => {
    const repo = createReviewDiscoveryRepository(db)

    // The cursor is exclusive: a page opened at PROP_CONNECTED never repeats
    // it, and one opened at the last seeded id yields none of them.
    const afterFirst = await repo.findDuePropertiesBatch(NOW, PROP_CONNECTED, PAGE)
    expect(mine(afterFirst)).toEqual([PROP_CONNECTED_2])

    const afterLast = await repo.findDuePropertiesBatch(NOW, PROP_CONNECTED_2, PAGE)
    expect(mine(afterLast)).toEqual([])

    // And the batch bound is the limit, not the candidate count.
    const bounded = await repo.findDuePropertiesBatch(NOW, null, 1)
    expect(bounded).toHaveLength(1)
  })

  it('records the deferred mark, then clears the error state on the next scheduled mark', async () => {
    const repo = createReviewDiscoveryRepository(db)
    const deferUntil = new Date(NOW.getTime() + 15 * 60 * 1000)

    await repo.markDiscoveryDeferred(PROP_CONNECTED, NOW, deferUntil, 'enqueue_failed')
    const deferred = await pool.query(
      `SELECT error_class, error_retry_at, next_incremental_at, last_success_at
         FROM review_sync_state WHERE property_id = $1 AND source = 'google'`,
      [PROP_CONNECTED],
    )
    expect(deferred.rows[0].error_class).toBe('enqueue_failed')
    expect(deferred.rows[0].error_retry_at).toEqual(deferUntil)
    expect(deferred.rows[0].next_incremental_at).toEqual(deferUntil)
    expect(deferred.rows[0].last_success_at).toBeNull()

    const nextDueAt = new Date(NOW.getTime() + 30 * 60 * 1000)
    await repo.markDiscoveryScheduled(PROP_CONNECTED, NOW, nextDueAt)
    const scheduled = await pool.query(
      `SELECT error_class, error_retry_at, next_incremental_at, last_success_at
         FROM review_sync_state WHERE property_id = $1 AND source = 'google'`,
      [PROP_CONNECTED],
    )
    expect(scheduled.rows[0].error_class).toBeNull()
    expect(scheduled.rows[0].error_retry_at).toBeNull()
    expect(scheduled.rows[0].next_incremental_at).toEqual(nextDueAt)
    expect(scheduled.rows[0].last_success_at).toEqual(NOW)
  })

  it('excludes a property with an in-flight import and includes it once the import completes', async () => {
    const repo = createReviewDiscoveryRepository(db)
    await seedImport(PROP_CONNECTED, { parent: 'processing', item: 'pending' })

    const duringImport = await repo.findDuePropertiesBatch(NOW, null, PAGE)
    expect(mine(duringImport)).toEqual([PROP_CONNECTED_2])

    await settleImport()

    const afterImport = await repo.findDuePropertiesBatch(NOW, null, PAGE)
    expect(mine(afterImport)).toEqual([PROP_CONNECTED, PROP_CONNECTED_2])
  })

  it('excludes a property whose import item is only queued, not yet processing', async () => {
    const repo = createReviewDiscoveryRepository(db)
    await seedImport(PROP_CONNECTED_2, { parent: 'queued', item: 'pending' })

    const due = await repo.findDuePropertiesBatch(NOW, null, PAGE)

    expect(mine(due)).toEqual([PROP_CONNECTED])
  })

  it('does not park a property behind a settled parent that left a pending item', async () => {
    // A cancelled request can leave items in `pending`. Requiring BOTH rows to
    // be in flight is what stops that stale pair from parking the property's
    // discovery forever.
    const repo = createReviewDiscoveryRepository(db)
    await seedImport(PROP_CONNECTED, { parent: 'cancelled', item: 'pending' })

    const due = await repo.findDuePropertiesBatch(NOW, null, PAGE)

    expect(mine(due)).toEqual([PROP_CONNECTED, PROP_CONNECTED_2])
  })

  it('carries the ladder activity evidence for each candidate', async () => {
    const repo = createReviewDiscoveryRepository(db)
    const lastNewReview = new Date('2026-08-21T09:00:00.000Z')
    const lastNotification = new Date('2026-08-21T11:30:00.000Z')
    await pool.query(
      `INSERT INTO review_sync_state
         (property_id, source, last_new_review_at, last_notification_at, updated_at)
       VALUES ($1, 'google', $2, $3, NOW())`,
      [PROP_CONNECTED, lastNewReview, lastNotification],
    )

    const due = await repo.findDuePropertiesBatch(NOW, null, PAGE)
    const candidate = due.find((c) => c.propertyId === PROP_CONNECTED)

    expect(candidate?.activity.lastNewReviewAt).toEqual(lastNewReview)
    expect(candidate?.activity.lastNotificationAt).toEqual(lastNotification)
    // properties.created_at — the never-active floor, always present.
    expect(candidate?.activity.observedSince).toBeInstanceOf(Date)

    // A property with no sync-state row at all reports nulls, not a crash.
    const never = due.find((c) => c.propertyId === PROP_CONNECTED_2)
    expect(never?.activity.lastNewReviewAt).toBeNull()
    expect(never?.activity.lastNotificationAt).toBeNull()
  })
})
