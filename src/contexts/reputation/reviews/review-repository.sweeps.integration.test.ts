import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { GOOGLE_PROVIDER_FIXTURES_V1 } from '#/shared/testing/google-provider-identifiers-v1'
import { getDb, type Database } from '#/shared/db'
import { googleConnectionId, propertyId, reviewId } from '#/shared/domain/ids'
import { getEnv } from '#/shared/config/env'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'
import type { Review } from '../domain/review-types'
import { createReviewRepository } from './review-repository.server'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  buildTestReview as makeReview,
  seedOrgs,
  seedProperties,
  truncateReviews,
} from './review.test-fixtures'
import { testReviewRepository } from './review-stores.test-fixtures'

const { accountId: GBP_ACCOUNT_ID, locationId: GBP_LOCATION_ID } =
  GOOGLE_PROVIDER_FIXTURES_V1['google-location-primary'].expectedSegments

let pool: Pool

const SWEEP_PROP = propertyId('71c00000-0000-4000-8000-000000000003')
const SWEEP_CONNECTION = '71c00000-0000-4000-8000-0000000000c1'
const SWEEP_OTHER_CONNECTION = '71c00000-0000-4000-8000-0000000000c2'

type SweepPropertyOptions = Readonly<{
  lifecycleState?: string
  bindingState?: string
  connectionStatus?: string
  /** 'other' binds the Property to a different connection than the reviews'. */
  propertyConnection?: 'other'
  deleted?: boolean
}>

/**
 * (Re)creates the Property the refresh sweep's reviews sit on, bound to Google
 * and active unless the options take it out of the set a sync can run for.
 */
async function seedSweepProperty(options: SweepPropertyOptions) {
  await pool.query('DELETE FROM properties WHERE id = $1', [SWEEP_PROP])
  for (const [id, status] of [
    [SWEEP_CONNECTION, options.connectionStatus ?? 'active'],
    [SWEEP_OTHER_CONNECTION, 'active'],
  ] as const) {
    await seedGoogleConnection(pool, {
      id: id,
      organizationId: ORG_A,
      googleSubject: `subject-${id}`,
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: status,
      onExistingId: 'refresh-status',
    })
  }
  const bindingState = options.bindingState ?? 'active'
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, google_connection_id,
        gbp_account_id, gbp_location_id, google_binding_state, lifecycle_state,
        deleted_at, created_at, updated_at)
     VALUES ($1, $2, 'Sweep Property', 'test-prop-sweep', 'UTC', $3, $4, $5, $6, $7,
             $8, NOW(), NOW())`,
    [
      SWEEP_PROP,
      ORG_A,
      options.propertyConnection === 'other' ? SWEEP_OTHER_CONNECTION : SWEEP_CONNECTION,
      GBP_ACCOUNT_ID,
      `${GBP_LOCATION_ID}-sweep`,
      bindingState,
      options.lifecycleState ?? 'active',
      options.deleted === true ? new Date() : null,
    ],
  )
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateReviews(pool)
  await seedOrgs(pool, [ORG_A, ORG_B])
  await seedProperties(pool)
})

describe.sequential('reviewRepository (integration)', () => {
  describe('readTrendPopulation', () => {
    it('returns the bounded current-revision population with local dates and separate star-only evidence', async () => {
      const repo = testReviewRepository(getDb())
      const future = new Date('2099-01-01T00:00:00Z')
      const fetchedAt = new Date('2026-08-20T00:00:00Z')
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000a1',
          externalId: 'trend-text',
          text: 'Helpful staff',
          reviewedAt: new Date('2026-08-15T22:30:00Z'),
          firstFetchedAt: fetchedAt,
          lastFetchedAt: fetchedAt,
          contentExpiresAt: future,
          sourceRevision: 3,
          analysisSequence: 11,
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000a2',
          externalId: 'trend-star-only',
          text: '   ',
          reviewedAt: new Date('2026-08-16T10:00:00Z'),
          firstFetchedAt: fetchedAt,
          lastFetchedAt: fetchedAt,
          contentExpiresAt: future,
          sourceRevision: 4,
          analysisSequence: 12,
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000a4',
          externalId: 'trend-before-window',
          text: 'Earlier retained evidence',
          reviewedAt: new Date('2025-08-15T10:00:00Z'),
          firstFetchedAt: fetchedAt,
          lastFetchedAt: fetchedAt,
          contentExpiresAt: future,
          analysisSequence: 10,
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000a3',
          externalId: 'trend-other-epoch',
          text: 'Must not cross the source-epoch fence',
          reviewedAt: new Date('2026-08-16T11:00:00Z'),
          firstFetchedAt: fetchedAt,
          lastFetchedAt: fetchedAt,
          contentExpiresAt: future,
          sourceEpoch: 1,
          sourceRevision: 1,
          analysisSequence: 13,
        }),
      )

      await expect(
        repo.readTrendPopulation({
          organizationId: ORG_A,
          propertyId: PROP_A,
          sourceEpoch: 0,
          timezone: 'Europe/Sofia',
          calendarProfileVersion: 'property-calendar-v1',
          startLocalDate: '2026-08-16',
          endLocalDate: '2026-08-16',
          limit: 10,
          detectEvidenceBeforeStart: true,
        }),
      ).resolves.toEqual({
        status: 'complete',
        reviews: [
          {
            reviewId: reviewId('1a000000-0000-0000-0000-0000000000a1'),
            // The observation adapter owns material numbering. Caller-supplied
            // legacy counters cannot make the first material revision non-1.
            sourceRevision: 1,
            analysisSequence: 11,
            localDate: '2026-08-16',
            hasText: true,
            rating: 5,
          },
          {
            reviewId: reviewId('1a000000-0000-0000-0000-0000000000a2'),
            sourceRevision: 1,
            analysisSequence: 12,
            localDate: '2026-08-16',
            hasText: false,
            rating: 5,
          },
        ],
        hasEvidenceBeforeStart: true,
      })

      await expect(
        repo.readTrendPopulation({
          organizationId: ORG_A,
          propertyId: PROP_A,
          sourceEpoch: 0,
          timezone: 'Europe/Sofia',
          calendarProfileVersion: 'property-calendar-v1',
          startLocalDate: '2026-08-16',
          endLocalDate: '2026-08-16',
          limit: 2,
          detectEvidenceBeforeStart: false,
        }),
      ).resolves.toEqual({ status: 'limit_exceeded' })
    })
  })

  describe('readTrendPopulation under a parallel plan', () => {
    // Session settings that make the planner choose a parallel plan wherever the
    // functions in the read allow one. The read calls the Property local-date
    // function, whose EXCEPTION clause starts a subtransaction: labelled
    // PARALLEL SAFE it failed on PostgreSQL 16 with "cannot start subtransactions
    // during a parallel operation", and the read answered `policy_unavailable`
    // for every Property whose `reviews` table was big enough for the planner.
    const FORCE_PARALLEL_PLAN = [
      '-c max_parallel_workers_per_gather=2',
      '-c parallel_setup_cost=0',
      '-c parallel_tuple_cost=0',
      '-c min_parallel_table_scan_size=0',
      '-c min_parallel_index_scan_size=0',
    ].join(' ')

    let parallelPool: Pool

    beforeAll(() => {
      parallelPool = new Pool({
        connectionString: getEnv().DATABASE_URL,
        max: 2,
        options: FORCE_PARALLEL_PLAN,
      })
    })

    afterAll(async () => {
      await parallelPool.end()
    })

    it('answers complete, as it does when the plan stays serial, and logs nothing', async () => {
      const seeding = testReviewRepository(getDb())
      const fetchedAt = new Date('2026-08-20T00:00:00Z')
      const future = new Date('2099-01-01T00:00:00Z')
      // The first is before the window, so the evidence boundary has something to find.
      for (const [index, reviewedAt] of [
        '2026-08-10T09:00:00Z',
        '2026-08-14T22:30:00Z',
        '2026-08-15T09:00:00Z',
        '2026-08-16T10:00:00Z',
      ].entries()) {
        await seeding.upsert(
          makeReview({
            id: `1a000000-0000-0000-0000-0000000000b${index}`,
            externalId: `trend-parallel-${index}`,
            text: 'Helpful staff',
            reviewedAt: new Date(reviewedAt),
            firstFetchedAt: fetchedAt,
            lastFetchedAt: fetchedAt,
            contentExpiresAt: future,
            analysisSequence: 20 + index,
          }),
        )
      }
      const warn = vi.fn()
      const repo = createReviewRepository(
        drizzle(parallelPool) as Database,
        () => new Date(),
        { warn },
        replyScopeEffects,
      )

      const result = await repo.readTrendPopulation({
        organizationId: ORG_A,
        propertyId: PROP_A,
        sourceEpoch: 0,
        timezone: 'Europe/Sofia',
        calendarProfileVersion: 'property-calendar-v1',
        startLocalDate: '2026-08-15',
        endLocalDate: '2026-08-16',
        limit: 10,
        detectEvidenceBeforeStart: true,
      })

      expect(
        (await parallelPool.query('SHOW max_parallel_workers_per_gather')).rows,
      ).toEqual([{ max_parallel_workers_per_gather: '2' }])
      expect(result).toMatchObject({
        status: 'complete',
        hasEvidenceBeforeStart: true,
      })
      expect(
        result.status === 'complete' ? result.reviews.map((r) => r.localDate) : [],
      ).toEqual(['2026-08-15', '2026-08-15', '2026-08-16'])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  describe('findExpiringBatchAcrossTenants keyset batches (BQC-1.5)', () => {
    // This repository operation is deliberately cross-tenant, so an
    // organization-scoped cleanup cannot isolate it from rows owned by other
    // integration suites. Keep this synthetic walk in a reserved historical
    // window: unrelated fixtures use contemporary dates and therefore cannot
    // satisfy the upper-bound predicate.
    const NOW = new Date('1900-06-01T12:00:00Z')

    // The sweep only offers reviews a sync can still be authorized for, so the
    // walk's reviews sit on an active Property bound to an active connection.
    beforeEach(async () => {
      await seedSweepProperty({})
    })

    async function seedExpiring(
      repo: ReturnType<typeof createReviewRepository>,
      idSuffix: string,
      expiresAt: Date,
    ) {
      await repo.upsert(
        makeReview({
          id: `1a000000-0000-0000-0000-0000000000${idSuffix}`,
          externalId: `ext-${idSuffix}`,
          propertyId: SWEEP_PROP,
          googleConnectionId: googleConnectionId(SWEEP_CONNECTION),
          contentExpiresAt: expiresAt,
        } as Partial<Omit<Review, 'id'>>),
      )
    }

    it('walks all expiring rows in order with no duplicates or skips', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
      const base = NOW.getTime()
      for (let i = 0; i < 5; i++) {
        await seedExpiring(repo, `b${i}`, new Date(base + (i + 1) * 60 * 1000))
      }

      const seen: string[] = []
      let cursor: { contentExpiresAt: Date; id: string } | null = null
      for (let batch = 0; batch < 10; batch++) {
        const rows = await repo.findExpiringBatchAcrossTenants(threshold, cursor, 2)
        if (rows.length === 0) break
        for (const r of rows) seen.push(r.externalId)
        const last = rows[rows.length - 1]
        cursor = {
          contentExpiresAt: last.contentExpiresAt as Date,
          id: last.id as string,
        }
      }

      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
      expect(seen).toEqual(['ext-b0', 'ext-b1', 'ext-b2', 'ext-b3', 'ext-b4'])
    })

    it('does not re-scan rows inserted behind the cursor mid-walk', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
      await seedExpiring(repo, 'c1', new Date(NOW.getTime() + 3 * 60 * 1000))
      await seedExpiring(repo, 'c2', new Date(NOW.getTime() + 4 * 60 * 1000))

      const first = await repo.findExpiringBatchAcrossTenants(threshold, null, 1)
      expect(first).toHaveLength(1)
      const cursor = {
        contentExpiresAt: first[0].contentExpiresAt as Date,
        id: first[0].id as string,
      }

      // Insert a row that sorts BEFORE the cursor — next run will catch it;
      // this run must not reprocess or loop.
      await seedExpiring(repo, 'c0', new Date(NOW.getTime() + 1 * 60 * 1000))

      const rest: string[] = []
      let c: typeof cursor | null = cursor
      for (let batch = 0; batch < 5; batch++) {
        const rows = await repo.findExpiringBatchAcrossTenants(threshold, c, 1)
        if (rows.length === 0) break
        rest.push(rows[0].externalId)
        c = {
          contentExpiresAt: rows[0].contentExpiresAt as Date,
          id: rows[0].id as string,
        }
      }
      expect(rest).toEqual(['ext-c2'])
    })

    it('offers the review of a Property a sync can still run for', async () => {
      const repo = testReviewRepository(getDb())
      const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
      await seedExpiring(repo, 'd0', new Date(NOW.getTime() + 60 * 1000))

      const rows = await repo.findExpiringBatchAcrossTenants(threshold, null, 10)

      expect(rows.map((row) => row.externalId)).toEqual(['ext-d0'])
    })

    // A sync for these can never succeed: the authorizer refuses a Property that
    // is not active and bound, or whose connection is not usable, so the sweep
    // would queue three failing attempts and a dead-letter entry every hour
    // between day 25 and day 30 (S14-02).
    it.each([
      ['archived', { lifecycleState: 'archived' }],
      ['suspended', { lifecycleState: 'suspended' }],
      ['soft-deleted', { deleted: true }],
      ['disconnected from Google', { bindingState: 'disconnected' }],
      ['bound to another connection than the review', { propertyConnection: 'other' }],
      [
        'on a connection that needs reauthorisation',
        { connectionStatus: 'reauth_required' },
      ],
    ] satisfies ReadonlyArray<readonly [string, SweepPropertyOptions]>)(
      'leaves out the reviews of a Property that is %s',
      async (_label, options) => {
        const repo = testReviewRepository(getDb())
        const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
        await seedSweepProperty(options)
        await seedExpiring(repo, 'd1', new Date(NOW.getTime() + 60 * 1000))

        const rows = await repo.findExpiringBatchAcrossTenants(threshold, null, 10)

        expect(rows.map((row) => row.externalId)).toEqual([])
      },
    )
  })

  describe('findExpiredBatchBeforeAcrossTenants keyset batches (BQC-8.3)', () => {
    const NOW = new Date('2025-06-01T12:00:00Z')

    async function seedLifecycle(
      repo: ReturnType<typeof createReviewRepository>,
      idSuffix: string,
      contentExpiresAt: Date | null,
    ) {
      await repo.upsert(
        makeReview({
          id: `1a000000-0000-0000-0000-0000000000${idSuffix}`,
          externalId: `ext-${idSuffix}`,
          contentExpiresAt,
        } as Partial<Omit<Review, 'id'>>),
      )
    }

    async function walkAll(
      repo: ReturnType<typeof createReviewRepository>,
      date: Date,
      batchSize: number,
    ): Promise<string[]> {
      const seen: string[] = []
      let cursor: { contentExpiresAt: Date; id: string } | null = null
      for (let batch = 0; batch < 20; batch++) {
        const rows = await repo.findExpiredBatchBeforeAcrossTenants(
          date,
          cursor,
          batchSize,
        )
        if (rows.length === 0) break
        for (const r of rows) seen.push(r.externalId)
        const last = rows[rows.length - 1]!
        cursor = {
          contentExpiresAt: last.contentExpiresAt as Date,
          id: last.id as string,
        }
      }
      return seen
    }

    it('walks all expired rows oldest-first across batch boundaries with no duplicates or skips', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const base = NOW.getTime()
      // 12 expired rows + noise: future and null lifecycle rows must be ignored.
      const suffixes = [
        'a0',
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
        'a6',
        'a7',
        'a8',
        'a9',
        'aa',
        'ab',
      ]
      for (const i of suffixes.keys()) {
        // Seed shuffled — expiry order, not insert order, drives the walk.
        const j = (i * 5) % 12
        await seedLifecycle(repo, suffixes[j]!, new Date(base - (12 - j) * 60 * 1000))
      }
      await seedLifecycle(repo, 'af', new Date(base + 60 * 1000)) // future
      await seedLifecycle(repo, 'b0', null) // row without a fetch clock

      const seen = await walkAll(repo, NOW, 5)

      expect(seen).toHaveLength(12)
      expect(new Set(seen).size).toBe(12)
      expect(seen).toEqual(suffixes.map((s) => `ext-${s}`))
    })

    it('uses an exclusive contentExpiresAt boundary (a row expiring exactly at now is NOT eligible)', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await seedLifecycle(repo, 'b1', new Date(NOW.getTime() - 1)) // 1ms before now
      await seedLifecycle(repo, 'b2', NOW) // exactly now — excluded

      const seen = await walkAll(repo, NOW, 10)

      expect(seen).toEqual(['ext-b1'])
    })

    it('breaks contentExpiresAt ties by id and resumes mid-tie without skips or repeats', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const tie = new Date(NOW.getTime() - 60 * 1000)
      // Same expiry instant for all three — order must fall back to id.
      await seedLifecycle(repo, 'c3', tie)
      await seedLifecycle(repo, 'c1', tie)
      await seedLifecycle(repo, 'c2', tie)

      const seen = await walkAll(repo, NOW, 2)

      expect(seen).toEqual(['ext-c1', 'ext-c2', 'ext-c3'])
    })

    it('does not re-scan rows inserted behind the cursor mid-walk', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      await seedLifecycle(repo, 'd2', new Date(NOW.getTime() - 2 * 60 * 1000))
      await seedLifecycle(repo, 'd3', new Date(NOW.getTime() - 1 * 60 * 1000))

      const first = await repo.findExpiredBatchBeforeAcrossTenants(NOW, null, 1)
      expect(first).toHaveLength(1)
      expect(first[0]!.externalId).toBe('ext-d2')
      const cursor = {
        contentExpiresAt: first[0]!.contentExpiresAt as Date,
        id: first[0]!.id as string,
      }

      // Insert a row that sorts BEFORE the cursor — the next sweep's fresh
      // walk will catch it; this walk must not reprocess or loop.
      await seedLifecycle(repo, 'd1', new Date(NOW.getTime() - 3 * 60 * 1000))

      const rest: string[] = []
      let c: typeof cursor | null = cursor
      for (let batch = 0; batch < 5; batch++) {
        const rows = await repo.findExpiredBatchBeforeAcrossTenants(NOW, c, 1)
        if (rows.length === 0) break
        rest.push(rows[0]!.externalId)
        c = {
          contentExpiresAt: rows[0]!.contentExpiresAt as Date,
          id: rows[0]!.id as string,
        }
      }
      expect(rest).toEqual(['ext-d3'])
    })
  })

  describe('countExpiredBeforeAcrossTenants (BQC-8.3)', () => {
    it('counts exactly the purge-eligible rows (exclusive boundary, null/future ignored)', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const NOW = new Date('2025-06-01T12:00:00Z')

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000001',
          externalId: 'ext-expired',
          contentExpiresAt: new Date(NOW.getTime() - 1),
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000002',
          externalId: 'ext-active',
          contentExpiresAt: NOW, // exactly now — NOT eligible (exclusive)
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000003',
          externalId: 'ext-null-lifecycle',
          contentExpiresAt: null,
        }),
      )

      expect(await repo.countExpiredBeforeAcrossTenants(NOW)).toBe(1)
      // One second later the boundary row becomes eligible too.
      expect(
        await repo.countExpiredBeforeAcrossTenants(new Date(NOW.getTime() + 1000)),
      ).toBe(2)
    })
  })
})
