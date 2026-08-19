// Review provider snapshot repository against real PostgreSQL.
//
// `finishMainScan` was the one repository path with no coverage against a live
// database, and it shipped two statements whose bound timestamps took part in
// interval arithmetic without a cast. PostgreSQL resolves `$n - interval` as
// `interval - interval`, so the parameter became an interval and the surrounding
// comparison had no operator:
//
//   operator does not exist: timestamp with time zone <= interval
//
// Mocked unit tests cannot see that — the type resolution happens in the server.
// The first google-closed-beta run that ever reached this path failed on it, so
// every completed scan died before writing its confirmation transition. These
// tests execute the real statements.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { properties, reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot.repository'

const ORGANIZATION_ID = 'review-snapshot-repo-test-org'
const PROPERTY_ID = '72000000-0000-4000-8000-000000000001'
const RUN_ID = '72000000-0000-4000-8000-000000000002'
const OTHER_RUN_ID = '72000000-0000-4000-8000-000000000003'
const STARTED_AT = new Date('2026-08-19T10:00:00.000Z')
const EXPIRES_AT = new Date('2026-08-19T22:00:00.000Z')

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const db = getDb()
  // `finishMainScan` publishes nothing, so a recording bus is enough and keeps
  // the test to the statements under examination.
  const published: unknown[] = []
  const repository = createReviewProviderSnapshotRepository(db, {
    publish: async (event: unknown) => {
      published.push(event)
    },
  } as unknown as Parameters<typeof createReviewProviderSnapshotRepository>[1])

  const clear = async () => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`)
  }

  beforeAll(async () => {
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'Snapshot repo test', ${ORGANIZATION_ID}, ${STARTED_AT})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Snapshot repo property',
      slug: 'snapshot-repo-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      processingRegion: 'europe',
      routingPolicyVersion: 1,
      profileVersion: 1,
      // The domain default: a property that has never been edited. The AI plane
      // used to reject this value outright (see drizzle/0060).
      sourceEpoch: 0,
    })
  })

  afterAll(clear)

  const seedCompletedMainScan = async () => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))
    await db.insert(reviewProviderSnapshotRuns).values({
      id: RUN_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      state: 'scanning',
      phase: 'main',
      // A finished main scan: the provider's total matches what was observed and
      // the cursor is spent, which is exactly the shape `finishMainScan` requires.
      expectedTotal: 2,
      mainPageCount: 1,
      mainUniqueCount: 2,
      mainCursorRef: null,
      startedAt: STARTED_AT,
      expiresAt: EXPIRES_AT,
    })
  }

  it('transitions a completed main scan into confirmation', async () => {
    await seedCompletedMainScan()

    const finished = await repository.finishMainScan({ runId: RUN_ID })

    expect(finished.status).toBe('confirming')
    const [row] = await db
      .select()
      .from(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))
      .limit(1)
    expect(row?.state).toBe('confirming')
    expect(row?.phase).toBe('confirmation')
    expect(row?.mainCursorRef).toBeNull()
    // startedAt + 12h, proving the deadline expression resolved as a timestamp
    // rather than collapsing into interval arithmetic.
    expect(row?.confirmationDeadline?.toISOString()).toBe('2026-08-19T22:00:00.000Z')
  })

  it('fails a main scan whose observed set does not match the provider total', async () => {
    await seedCompletedMainScan()
    await db
      .update(reviewProviderSnapshotRuns)
      .set({ mainUniqueCount: 1 })
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))

    const finished = await repository.finishMainScan({ runId: RUN_ID })

    expect(finished).toMatchObject({ status: 'failed', code: 'set_mismatch' })
  })

  it('reports the terminal state when another worker already transitioned the run', async () => {
    await seedCompletedMainScan()
    await db
      .update(reviewProviderSnapshotRuns)
      .set({ state: 'confirming', phase: 'confirmation' })
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))

    // Idempotence matters: a continuation that races the transition must observe
    // `confirming` instead of failing the run a second time.
    await expect(repository.finishMainScan({ runId: RUN_ID })).resolves.toMatchObject({
      status: 'confirming',
    })
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, OTHER_RUN_ID))
  })
})
