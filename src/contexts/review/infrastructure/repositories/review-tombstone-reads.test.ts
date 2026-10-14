// Review context — an erased Review (tombstone) in the repository's reads
// (S10-01, S10-02). Real PostgreSQL.
//
// Google deleted a review, the snapshot sync erased the Review row
// (`provider_deleted`), and the row then reached code that only expects a live
// one: `reviewFromRow` refuses a row without its provider values, so a finder
// that mapped it threw `invalid_row` for the whole read. Each finder keeps the
// contract its callers were written against — `findById` "or null", the
// eligible reads "absence = unavailable", the lifecycle sweeps "rows to
// refresh or purge" — and an erased Review is simply absent from all of them.
//
// Two tombstones are exercised side by side because both exist: one erased
// through `eraseReviewSourceContent` today (which clears the content clock)
// and one in the shape the same function left before it cleared the clock,
// which the closed beta already holds and no migration repairs.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  insertLegacyTombstone,
  insertLiveReview,
  type TombstoneState,
} from '#/shared/testing/review-tombstone-fixtures'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createEligibleReads } from '../../application/eligible-reads'
import { createAiReviewSource } from '../../application/ai-review-source'
import { requireAccessibleReview } from '../../application/use-cases/reply-access'
import { createReviewRepository } from './review.repository'
import { eraseReviewSourceContent } from '../review-source-content-store'

const ORG = organizationId('org-review-tombstone-reads-1111111111')
const PROPERTY = propertyId('7e100000-0000-4000-8000-000000000001')
const LIVE = reviewId('7e100000-0000-4000-8000-0000000000a1')
const LEGACY_TOMBSTONE = reviewId('7e100000-0000-4000-8000-0000000000a2')
const ERASED_TODAY = reviewId('7e100000-0000-4000-8000-0000000000a3')

const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments
const CONNECTION = '7e100000-0000-4000-8000-0000000000c1'

const FETCHED_AT = new Date('2026-10-02T09:00:00.000Z')
const READ_AT = new Date('2026-10-14T09:00:00.000Z')
// A content clock that has not passed at READ_AT: the shape that made a
// tombstone look like content still held.
const CLOCK_STILL_RUNNING = new Date('2026-11-01T09:00:00.000Z')

// The lifecycle sweeps are cross-tenant, so rows other suites leave behind
// would join their walks. A window in 1900 cannot hold anyone else's fixture.
const SWEEP_LIVE = reviewId('7e100000-0000-4000-8000-0000000000b1')
const SWEEP_TOMBSTONE = reviewId('7e100000-0000-4000-8000-0000000000b2')
const SWEEP_TOMBSTONE_EXPIRED = reviewId('7e100000-0000-4000-8000-0000000000b3')
const SWEEP_TOMBSTONE_CLOCK = new Date('1900-06-01T12:00:00.000Z')
const SWEEP_LIVE_CLOCK = new Date('1900-06-02T12:00:00.000Z')
const SWEEP_THRESHOLD = new Date('1900-07-01T12:00:00.000Z')

let pool: Pool
const db = getDb()
const repo = createReviewRepository(db, () => READ_AT)

async function clean(): Promise<void> {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedTenant(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Tombstone reads', $2, NOW())`,
    [ORG, `tombstone-reads-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Tombstone reads property', $3, 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG, `tombstone-reads-property-${process.pid}`],
  )
}

/**
 * The refresh sweep offers only reviews a sync can still run for, so its Review
 * sits on a Property bound to Google through an active connection.
 */
async function bindPropertyToGoogle(): Promise<void> {
  await pool.query(
    `INSERT INTO google_connections
       (id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        visibility, status, credential_use_state, created_at, updated_at)
     VALUES ($1, $2, 'subject-tombstone-reads', 'enc-a', 'enc-r',
             NOW() + INTERVAL '1 day',
             ARRAY['https://www.googleapis.com/auth/business.manage'],
             'seed-user', 'organization', 'active', 'active', NOW(), NOW())`,
    [CONNECTION, ORG],
  )
  await pool.query(
    `UPDATE properties
        SET google_connection_id = $1, gbp_account_id = $2, gbp_location_id = $3,
            google_binding_state = 'active'
      WHERE id = $4`,
    [CONNECTION, GBP_ACCOUNT_ID, GBP_LOCATION_ID, PROPERTY],
  )
}

async function eraseThroughTheLifecycle(
  id: string,
  state: TombstoneState,
): Promise<void> {
  const erased = await db.transaction((tx) =>
    eraseReviewSourceContent(tx, {
      reviewId: reviewId(id),
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      expectedSourceRevision: 0,
      state,
    }),
  )
  expect(erased).toBe(true)
}

const scope = { organizationId: ORG, propertyId: PROPERTY } as const

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await clean()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedTenant()
  await insertLiveReview(pool, {
    ...scope,
    id: LIVE,
    externalId: 'tombstone-reads-live',
    contentExpiresAt: CLOCK_STILL_RUNNING,
    reviewedAt: new Date('2026-09-30T12:00:00.000Z'),
    lastFetchedAt: FETCHED_AT,
  })
  await insertLegacyTombstone(pool, {
    ...scope,
    id: LEGACY_TOMBSTONE,
    contentExpiresAt: CLOCK_STILL_RUNNING,
    lastFetchedAt: FETCHED_AT,
  })
  await insertLiveReview(pool, {
    ...scope,
    id: ERASED_TODAY,
    externalId: 'tombstone-reads-erased-today',
    contentExpiresAt: CLOCK_STILL_RUNNING,
    reviewedAt: new Date('2026-09-29T12:00:00.000Z'),
    lastFetchedAt: FETCHED_AT,
  })
  await eraseThroughTheLifecycle(ERASED_TODAY, 'provider_deleted')
})

describe.sequential('an erased Review in the repository reads', () => {
  it.each([
    ['one erased before the clock was cleared', LEGACY_TOMBSTONE],
    ['one erased today', ERASED_TODAY],
  ])('findById answers null for %s, never an exception', async (_label, id) => {
    await expect(repo.findById(id, ORG)).resolves.toBeNull()
  })

  it('findById still returns a live Review', async () => {
    const found = await repo.findById(LIVE, ORG)

    expect(found).toMatchObject({ id: LIVE, rating: 5, text: 'A live review' })
  })

  it('findByIds leaves erased Reviews out of the answer and keeps the live one', async () => {
    const found = await repo.findByIds([LIVE, LEGACY_TOMBSTONE, ERASED_TODAY], ORG)

    expect(found.map((review) => review.id)).toEqual([LIVE])
  })

  it('findByPropertyId skips erased Reviews, so a limit is spent on live ones', async () => {
    // An erased row has no review date and PostgreSQL sorts NULL first in a
    // descending read, so without the filter the tombstones take the limit.
    const found = await repo.findByPropertyId(PROPERTY, ORG, { limit: 1 })

    expect(found.map((review) => review.id)).toEqual([LIVE])
  })

  it('findByOrganizationId skips erased Reviews', async () => {
    const found = await repo.findByOrganizationId(ORG)

    expect(found.map((review) => review.id)).toEqual([LIVE])
  })

  it('findRecentEligibleByPropertyId does not serve an erased Review whose clock is still running', async () => {
    const found = await repo.findRecentEligibleByPropertyId(
      PROPERTY,
      ORG,
      { limit: 10 },
      READ_AT,
    )

    expect(found.map((review) => review.id)).toEqual([LIVE])
  })

  it('findIdsByContentFilter does not list an erased Review as eligible content', async () => {
    const ids = await repo.findIdsByContentFilter(ORG, {}, READ_AT)

    expect(ids).toEqual([LIVE])
  })

  it.each<TombstoneState>(['provider_deleted', 'source_expired'])(
    'the erase clears the content clock of a Review it makes %s',
    async (state) => {
      const id = '7e100000-0000-4000-8000-0000000000a4'
      await insertLiveReview(pool, {
        ...scope,
        id,
        externalId: `tombstone-reads-${state}`,
        contentExpiresAt: CLOCK_STILL_RUNNING,
        lastFetchedAt: FETCHED_AT,
      })

      await eraseThroughTheLifecycle(id, state)

      const stored = await pool.query<{
        source_content_state: string
        content_expires_at: Date | null
        last_fetched_at: Date | null
      }>(
        `SELECT source_content_state, content_expires_at, last_fetched_at
         FROM reviews WHERE id = $1`,
        [id],
      )
      expect(stored.rows).toEqual([
        {
          source_content_state: state,
          content_expires_at: null,
          // The fetch history is stable identity, not provider content.
          last_fetched_at: FETCHED_AT,
        },
      ])
    },
  )
})

describe.sequential('the callers of those reads', () => {
  const eligible = createEligibleReads({ reviewRepo: repo, clock: () => READ_AT })

  it('the eligible single read answers not_found, not an exception', async () => {
    await expect(eligible.getReviewSnippetById(LEGACY_TOMBSTONE, ORG)).resolves.toEqual({
      status: 'not_found',
    })
    await expect(eligible.getReviewSnippetById(ERASED_TODAY, ORG)).resolves.toEqual({
      status: 'not_found',
    })
  })

  it('the eligible batch read returns the live snippet and leaves the erased ones out', async () => {
    const snippets = await eligible.getReviewSnippetsByIds(
      [LIVE, LEGACY_TOMBSTONE, ERASED_TODAY],
      ORG,
    )

    expect([...snippets.keys()]).toEqual([LIVE])
    expect(snippets.get(LIVE)).toMatchObject({ text: 'A live review', rating: 5 })
  })

  it('the eligible rating read answers null for an erased Review', async () => {
    await expect(
      eligible.getEligibleRatingById(LEGACY_TOMBSTONE, ORG),
    ).resolves.toBeNull()
    await expect(eligible.getEligibleRatingById(ERASED_TODAY, ORG)).resolves.toBeNull()
  })

  it('the AI review source reports not_found for an erased Review', async () => {
    const source = createAiReviewSource({
      findById: repo.findById,
      readForAi: repo.readForAi,
      readTrendPopulation: repo.readTrendPopulation,
      assertCurrentForAi: repo.assertCurrentForAi,
      readReplyStateRevision: repo.readReplyStateRevision,
    })

    await expect(
      source.readCurrentSource({ organizationId: ORG, reviewId: LEGACY_TOMBSTONE }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('a manager who opens an erased Review to reply is told it is not found', async () => {
    const staffPublicApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    }
    const ctx = {
      organizationId: ORG,
      userId: userId('user-tombstone-reads'),
      role: 'AccountAdmin',
    } as AuthContext

    await expect(
      requireAccessibleReview(
        { reviewRepo: repo, staffPublicApi },
        ctx,
        LEGACY_TOMBSTONE,
      ),
    ).rejects.toMatchObject({ _tag: 'ReviewError', code: 'review_not_found' })
  })
})

describe.sequential('an erased Review in the cross-tenant lifecycle sweeps', () => {
  beforeEach(async () => {
    await bindPropertyToGoogle()
    await insertLegacyTombstone(pool, {
      ...scope,
      id: SWEEP_TOMBSTONE,
      contentExpiresAt: SWEEP_TOMBSTONE_CLOCK,
      lastFetchedAt: new Date('1900-05-02T12:00:00.000Z'),
    })
    await insertLegacyTombstone(pool, {
      ...scope,
      id: SWEEP_TOMBSTONE_EXPIRED,
      state: 'source_expired',
      contentExpiresAt: new Date('1900-05-30T12:00:00.000Z'),
      lastFetchedAt: new Date('1900-04-30T12:00:00.000Z'),
    })
    await insertLiveReview(pool, {
      ...scope,
      id: SWEEP_LIVE,
      googleConnectionId: CONNECTION,
      externalId: 'tombstone-reads-sweep-live',
      contentExpiresAt: SWEEP_LIVE_CLOCK,
      lastFetchedAt: new Date('1900-05-03T12:00:00.000Z'),
    })
  })

  it('findExpiringBatchAcrossTenants returns the live row and skips the tombstones that sort first', async () => {
    const batch = await repo.findExpiringBatchAcrossTenants(SWEEP_THRESHOLD, null, 10)

    expect(batch.map((review) => review.id)).toEqual([SWEEP_LIVE])
  })

  it('findExpiredBatchBeforeAcrossTenants does not offer a tombstone for purge', async () => {
    const batch = await repo.findExpiredBatchBeforeAcrossTenants(
      SWEEP_THRESHOLD,
      null,
      10,
    )

    expect(batch.map((review) => review.id)).toEqual([SWEEP_LIVE])
  })

  it('countExpiredBeforeAcrossTenants counts live rows only, so the drill probe can reach zero', async () => {
    await expect(repo.countExpiredBeforeAcrossTenants(SWEEP_THRESHOLD)).resolves.toBe(1)
  })
})
