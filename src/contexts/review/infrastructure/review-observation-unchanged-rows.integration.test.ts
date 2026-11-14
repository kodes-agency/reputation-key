import {
  eraseReviewSourceContent,
  replyScopeEffects,
  writeObservedReviewIdentity,
} from '#/contexts/reputation/application/public-api'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewRepository } from './repositories/review.repository'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'

// Each snapshot pass reads every review twice. A read that leaves the Review
// and its current Material Review Revision as stored writes neither row; a
// change in any column the writes set still does.

const ORG = organizationId('review-unchanged-rows-org-a')
const OTHER_ORG = organizationId('review-unchanged-rows-org-b')
const PROPERTY = propertyId('f9c40000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9c40000-0000-4000-8000-000000000002')
const FIRST_READ = new Date('2026-11-12T06:00:00.000Z')
const SOURCE_TIME = new Date('2026-11-01T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const CONTENT_TTL_MS = 30 * 24 * HOUR_MS

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'google_reply_observation_heads',
    'google_reply_observations',
    'replies',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_released_sequences',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

type ReviewWrite = Omit<Review, 'createdAt' | 'updatedAt'>

const fetchedAt = (hours: number) => new Date(FIRST_READ.getTime() + hours * HOUR_MS)

function readAt(hours: number): ReviewWrite {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-unchanged-rows',
    externalLocationId: 'locations/unchanged-rows',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Quiet room, friendly staff',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: SOURCE_TIME,
    expiresAt: new Date('2027-11-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: SOURCE_TIME,
    sourceUpdatedAt: SOURCE_TIME,
    firstFetchedAt: FIRST_READ,
    lastFetchedAt: fetchedAt(hours),
    contentExpiresAt: new Date(fetchedAt(hours).getTime() + CONTENT_TTL_MS),
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 26,
    aiSourceDigest: 'a'.repeat(64),
  }
}

/** The same read, `hours` later, carrying the counters the first one stored. */
const again = (stored: Review, hours: number): ReviewWrite => ({
  ...readAt(hours),
  sourceRevision: stored.sourceRevision,
  analysisSequence: stored.analysisSequence,
})

const keyOf = (read: number) => read.toString(16).padStart(64, '0')

function recordedRead(candidate: ReviewWrite, read: number) {
  const observedAt = candidate.lastFetchedAt!
  return createAtomicReviewCommandStore(
    getDb(),
    () => observedAt,
    undefined,
    undefined,
    replyScopeEffects,
  ).upsertAndRecord(
    candidate,
    (persisted) =>
      (persisted.analysisSequence === 1 ? reviewCreated : reviewUpdated)({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: observedAt,
      }),
    observedAt,
    keyOf(read),
    'ongoing',
    undefined,
    true,
  )
}

function quietRead(candidate: ReviewWrite, read: number) {
  const observedAt = candidate.lastFetchedAt!
  return createReviewRepository(
    getDb(),
    () => observedAt,
    undefined,
    replyScopeEffects,
  ).upsert(candidate, observedAt, keyOf(read), 'ongoing', true)
}

const stamps = async () => {
  const pool = getPool()
  const review = await pool.query<{ updatedAt: Date }>(
    `SELECT updated_at AS "updatedAt" FROM reviews WHERE organization_id = $1 AND id = $2`,
    [ORG, REVIEW],
  )
  const revision = await pool.query<{ updatedAt: Date }>(
    `SELECT updated_at AS "updatedAt" FROM material_review_revisions
      WHERE organization_id = $1 AND review_id = $2`,
    [ORG, REVIEW],
  )
  return {
    review: review.rows.map((row) => row.updatedAt),
    revision: revision.rows.map((row) => row.updatedAt),
  }
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Unchanged rows property', 'review-unchanged-rows-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('re-reading a review Google has not changed', () => {
  it('writes neither the Review row nor its Material Review Revision', async () => {
    const first = await recordedRead(readAt(0), 1)
    const before = await stamps()

    await quietRead(again(first, 6), 2)
    await quietRead(again(first, 12), 3)

    expect(await stamps()).toEqual(before)
    expect(before.review).toEqual([fetchedAt(0)])
    expect(before.revision).toEqual([fetchedAt(0)])
  })

  it('returns the stored Review row', async () => {
    const first = await recordedRead(readAt(0), 1)

    const reread = await quietRead(again(first, 6), 2)

    expect(reread.updatedAt).toEqual(fetchedAt(0))
  })
})

describe('re-reading a review whose stored row differs from the read', () => {
  it('writes both rows when the content was erased and Google shows it again', async () => {
    const first = await recordedRead(readAt(0), 1)
    await getDb().transaction((tx) =>
      eraseReviewSourceContent(
        tx,
        {
          reviewId: REVIEW,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceEpoch: 0,
          expectedSourceRevision: 1,
          state: 'provider_deleted',
        },
        replyScopeEffects,
      ),
    )

    await quietRead(again(first, 6), 2)

    expect(await stamps()).toEqual({
      review: [fetchedAt(6)],
      revision: [fetchedAt(6)],
    })
  })

  const revisionColumns: ReadonlyArray<readonly [string, string]> = [
    ['rating', '2'],
    ['normalized_text', `'something else'`],
  ]
  it.each(revisionColumns)(
    'writes the Material Review Revision when %s differs',
    async (column, value) => {
      const first = await recordedRead(readAt(0), 1)
      await getPool().query(
        `UPDATE material_review_revisions SET ${column} = ${value}
          WHERE organization_id = $1 AND review_id = $2`,
        [ORG, REVIEW],
      )

      await quietRead(again(first, 6), 2)

      expect((await stamps()).revision).toEqual([fetchedAt(6)])
    },
  )

  // The check constraint ties content_state, content_erased_at, rating and
  // normalized_text together, so an expired revision differs in all of them.
  it('writes the Material Review Revision when it holds erased content', async () => {
    const first = await recordedRead(readAt(0), 1)
    await getPool().query(
      `UPDATE material_review_revisions
          SET content_state = 'source_expired', content_erased_at = now(),
              rating = NULL, normalized_text = NULL
        WHERE organization_id = $1 AND review_id = $2`,
      [ORG, REVIEW],
    )

    await quietRead(again(first, 6), 2)

    expect((await stamps()).revision).toEqual([fetchedAt(6)])
  })

  it.each([
    ['source_digest', `'${'b'.repeat(64)}'`],
    ['normalized_digest', `'${'c'.repeat(64)}'`],
  ])(
    'leaves the Material Review Revision alone when only %s differs and the read adopts no baseline',
    async (column, value) => {
      const first = await recordedRead(readAt(0), 1)
      await getPool().query(
        `UPDATE material_review_revisions SET ${column} = ${value}
          WHERE organization_id = $1 AND review_id = $2`,
        [ORG, REVIEW],
      )

      await quietRead(again(first, 6), 2)

      expect((await stamps()).revision).toEqual([fetchedAt(0)])
    },
  )

  // A legacy baseline compares in shadow and is adopted: the revision gets the
  // current version and both digests, so its row has to be written.
  it('writes the Material Review Revision when a read adopts a legacy baseline', async () => {
    const first = await recordedRead(readAt(0), 1)
    const pool = getPool()
    await pool.query(
      `UPDATE reviews SET material_normalization_version = 'legacy-unverified-v0',
              material_source_digest = NULL, material_normalized_digest = NULL
        WHERE organization_id = $1 AND id = $2`,
      [ORG, REVIEW],
    )
    await pool.query(
      `UPDATE material_review_revisions SET normalization_version = 'legacy-unverified-v0',
              source_digest = NULL, normalized_digest = NULL
        WHERE organization_id = $1 AND review_id = $2`,
      [ORG, REVIEW],
    )

    await quietRead(again(first, 6), 2)

    const adopted = await pool.query<{
      version: string
      source: string | null
      normalized: string | null
    }>(
      `SELECT normalization_version AS version, source_digest AS source,
              normalized_digest AS normalized
         FROM material_review_revisions WHERE organization_id = $1 AND review_id = $2`,
      [ORG, REVIEW],
    )
    expect(adopted.rows).toHaveLength(1)
    expect(adopted.rows[0]!.version).toBe('review-material-v1')
    expect(adopted.rows[0]!.source).toMatch(/^[0-9a-f]{64}$/)
    expect(adopted.rows[0]!.normalized).toMatch(/^[0-9a-f]{64}$/)
    expect((await stamps()).revision).toEqual([fetchedAt(6)])
  })

  it('writes both rows when the review text changed', async () => {
    const first = await recordedRead(readAt(0), 1)

    await recordedRead(
      { ...again(first, 6), text: 'Noisy room', sourceUpdatedAt: fetchedAt(5) },
      2,
    )

    const after = await stamps()
    expect(after.review).toEqual([fetchedAt(6)])
    expect(after.revision).toHaveLength(2)
  })
})

describe('the Review row write compares every column it sets', () => {
  const OTHER_PROPERTY = propertyId('f9c40000-0000-4000-8000-000000000003')
  const SOURCE_DIGEST = 'a'.repeat(64)
  const NORMALIZED_DIGEST = 'b'.repeat(64)
  const material = {
    materialRevision: 1,
    normalizationVersion: 'review-material-v1',
    sourceDigest: SOURCE_DIGEST,
    normalizedDigest: NORMALIZED_DIGEST,
  }
  const sequence = 1
  const observation = (): ReviewWrite => ({
    ...readAt(6),
    sourceRevision: 1,
    analysisSequence: 1,
  })

  async function seedStored(): Promise<void> {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Other unchanged rows property', 'review-unchanged-rows-other', 'UTC')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_PROPERTY, ORG],
    )
    await getPool().query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, source_epoch, source_revision,
         source_observation_sequence, material_normalization_version,
         material_source_digest, material_normalized_digest, analysis_sequence,
         source_content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, 'google', 0, 1, $4, 'review-material-v1', $5, $6, 1,
                 'active', $7, $7)`,
      [REVIEW, ORG, PROPERTY, sequence, SOURCE_DIGEST, NORMALIZED_DIGEST, FIRST_READ],
    )
  }

  const writeOnce = (
    existing: typeof reviews.$inferSelect,
    review: ReviewWrite = observation(),
  ) =>
    getDb().transaction((tx) =>
      writeObservedReviewIdentity(
        tx,
        existing,
        review,
        material,
        sequence,
        fetchedAt(6),
        replyScopeEffects,
      ),
    )

  const storedRow = async () => {
    const [row] = await getDb()
      .select()
      .from(reviews)
      .where(and(eq(reviews.organizationId, ORG), eq(reviews.id, REVIEW)))
    return row!
  }

  it('writes nothing when every column is as stored', async () => {
    await seedStored()

    const result = await writeOnce(await storedRow())

    expect(result.updatedAt).toEqual(FIRST_READ)
    expect((await storedRow()).updatedAt).toEqual(FIRST_READ)
  })

  async function seedConnection(): Promise<string> {
    const userId = randomUUID()
    const connectionId = randomUUID()
    const pool = getPool()
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Unchanged rows manager', $2, true, now(), now())`,
      [userId, `${userId}@example.test`],
    )
    await seedGoogleConnection(pool, {
      id: connectionId,
      organizationId: ORG,
      googleSubject: `subject-${connectionId}`,
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      connectedBy: userId,
    })
    return connectionId
  }

  // Each case differs from the read in exactly one column. The content state
  // and erasure time are tied together by a check constraint, so a stored row
  // cannot hold one without the other: those two differ in the row handed to
  // the writer instead.
  type StoredColumn = Readonly<{
    column: string
    value: () => Promise<unknown> | unknown
  }>
  const storedColumns: ReadonlyArray<StoredColumn> = [
    { column: 'property_id', value: () => OTHER_PROPERTY },
    { column: 'google_connection_id', value: seedConnection },
    { column: 'sentiment_label', value: () => 'positive' },
    { column: 'sentiment_score', value: () => 0.5 },
    { column: 'source_seen_generation', value: () => randomUUID() },
    { column: 'source_epoch', value: () => 3 },
    { column: 'source_revision', value: () => 2 },
    { column: 'source_observation_sequence', value: () => 0 },
    { column: 'material_normalization_version', value: () => 'legacy-unverified-v0' },
    { column: 'material_source_digest', value: () => 'c'.repeat(64) },
    { column: 'material_normalized_digest', value: () => 'd'.repeat(64) },
    { column: 'analysis_sequence', value: () => 2 },
  ]

  it.each(storedColumns)('writes the row when stored $column differs', async (entry) => {
    await seedStored()
    const value = await entry.value()
    // The head check ties the version to its digests, so the legacy form
    // clears them in the same statement.
    const legacy = entry.column === 'material_normalization_version'
    await getPool().query(
      `UPDATE reviews SET ${entry.column} = $3
         ${legacy ? ', material_source_digest = NULL, material_normalized_digest = NULL' : ''}
        WHERE organization_id = $1 AND id = $2`,
      [ORG, REVIEW, value],
    )

    const result = await writeOnce(await storedRow())

    expect(result.updatedAt).toEqual(fetchedAt(6))
    expect((await storedRow()).updatedAt).toEqual(fetchedAt(6))
  })

  it.each([
    ['source_content_state', { sourceContentState: 'source_expired' }],
    ['source_content_erased_at', { sourceContentErasedAt: SOURCE_TIME }],
  ] as const)('writes the row when %s differs', async (_column, held) => {
    await seedStored()

    const result = await writeOnce({ ...(await storedRow()), ...held })

    expect(result.updatedAt).toEqual(fetchedAt(6))
    expect((await storedRow()).updatedAt).toEqual(fetchedAt(6))
  })
})
