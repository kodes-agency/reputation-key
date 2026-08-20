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
      bound ? '1234567890' : null,
      bound ? `location-${p.id.slice(-2)}` : null,
      p.bindingState,
      p.lifecycleState ?? 'active',
      p.deleted ? NOW.toISOString() : null,
    ],
  )
}

async function clearSeed(): Promise<void> {
  await pool.query(`DELETE FROM review_sync_state WHERE property_id = ANY($1)`, [
    ALL_PROPS,
  ])
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
      locationName: 'accounts/1234567890/locations/location-01',
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
})
