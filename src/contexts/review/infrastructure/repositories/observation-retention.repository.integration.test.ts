import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from '../review-command-store'
import { reviewCreated, reviewUpdated } from '../../domain/events'
import type { Review } from '../../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId, type ReviewId } from '#/shared/domain/ids'
import { createReviewRepository } from './review.repository'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'
import { createRestatedRevisionQuery } from './restated-revision.repository'
import { selectRevisionBindingComparisons } from '../source-epoch-carry'
import { eraseReviewSourceContent } from '../review-source-content-store'
import { createObservationRetention } from './observation-retention.repository'

// The rows the writer stored before 2026-10-24, one per read, are rebuilt here
// in SQL (`appendRepeat` copies the newest row as that writer did); everything
// Google reported differently goes through the real writer.

const ORG = organizationId('review-observation-retention-org-a')
const OTHER_ORG = organizationId('review-observation-retention-org-b')
const PROPERTY = propertyId('f9c50000-0000-4000-8000-000000000001')
const REVIEW_A = reviewId('f9c50000-0000-4000-8000-00000000000a')
const REVIEW_B = reviewId('f9c50000-0000-4000-8000-00000000000b')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const CONTENT_TTL_MS = 30 * DAY_MS
const SCOPE = { organizationId: ORG }

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

/** What Google returns for a review, as fetched at `at`. */
function readOf(
  id: ReviewId,
  at: Date,
  overrides: Partial<ReviewWrite> = {},
): ReviewWrite {
  return {
    id,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: `provider-review-${id.slice(-2)}`,
    externalLocationId: 'locations/observation-retention',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Quiet room, friendly staff',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-08-01T12:00:00.000Z'),
    firstFetchedAt: at,
    lastFetchedAt: at,
    contentExpiresAt: new Date(at.getTime() + CONTENT_TTL_MS),
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 26,
    aiSourceDigest: 'a'.repeat(64),
    ...overrides,
  }
}

let keys = 0
const nextKey = () => {
  keys += 1
  return keys.toString(16).padStart(64, '0')
}

function recordedRead(candidate: ReviewWrite) {
  const observedAt = candidate.lastFetchedAt!
  return createAtomicReviewCommandStore(getDb(), () => observedAt).upsertAndRecord(
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
    nextKey(),
    'ongoing',
    undefined,
    true,
  )
}

function quietRead(candidate: ReviewWrite) {
  const observedAt = candidate.lastFetchedAt!
  return createReviewRepository(getDb(), () => observedAt).upsert(
    candidate,
    observedAt,
    nextKey(),
    'ongoing',
    true,
  )
}

/** One more read the old writer recorded: a copy of the newest row, keyed and
 * timed as that read, with the Review's clocks moved as the writer moved them. */
async function appendRepeat(id: ReviewId, at: Date): Promise<void> {
  const until = new Date(at.getTime() + CONTENT_TTL_MS)
  await getPool().query(
    `INSERT INTO review_source_observations (
       review_id, observation_sequence, organization_id, property_id, source_epoch,
       observation_key, observation_digest, material_revision, observed_at,
       content_expires_at, source_created_at, source_updated_at, source_digest,
       normalization_version, normalized_digest, comparison_result, rating,
       original_text, translated_text, language_code, reviewer_name,
       reviewer_profile_photo_url, reviewed_at, content_state, content_erased_at,
       created_at, updated_at)
     SELECT o.review_id, r.source_observation_sequence + 1, o.organization_id,
            o.property_id, o.source_epoch, $2, o.observation_digest,
            o.material_revision, $3, $4, o.source_created_at, o.source_updated_at,
            o.source_digest, o.normalization_version, o.normalized_digest,
            'unchanged', o.rating, o.original_text, o.translated_text,
            o.language_code, o.reviewer_name, o.reviewer_profile_photo_url,
            o.reviewed_at, o.content_state, o.content_erased_at, $3, $3
       FROM reviews r
       JOIN review_source_observations o
         ON o.review_id = r.id AND o.observation_sequence = r.source_observation_sequence
      WHERE r.id = $1 AND r.organization_id = $5`,
    [id, nextKey(), at, until, ORG],
  )
  await getPool().query(
    `UPDATE reviews
        SET source_observation_sequence = source_observation_sequence + 1,
            last_fetched_at = $2, content_expires_at = $3
      WHERE id = $1 AND organization_id = $4`,
    [id, at, until, ORG],
  )
  await getPool().query(
    `UPDATE review_source_contents SET last_fetched_at = $2, content_expires_at = $3
      WHERE review_id = $1 AND organization_id = $4`,
    [id, at, until, ORG],
  )
}

async function appendRepeats(id: ReviewId, times: ReadonlyArray<Date>): Promise<void> {
  for (const at of times) await appendRepeat(id, at)
}

type Row = Readonly<{
  sequence: number
  comparison: string
  state: string
  digest: string
  text: string | null
  rating: number | null
}>

const rowsOf = async (id: ReviewId): Promise<Row[]> =>
  (
    await getPool().query<Row>(
      `SELECT observation_sequence::int AS sequence, comparison_result AS comparison,
              content_state AS state, observation_digest AS digest,
              original_text AS text, rating
         FROM review_source_observations
        WHERE organization_id = $1 AND review_id = $2
        ORDER BY observation_sequence`,
      [ORG, id],
    )
  ).rows

const sequencesOf = async (id: ReviewId) =>
  (await rowsOf(id)).map((row) => [row.sequence, row.comparison])

const lifecycleFindings = async (id: ReviewId) =>
  (
    await createReviewSourceContentLifecycleStore(getDb()).readInspectionBatch({
      evaluatedAt: new Date('2030-01-01T00:00:00.000Z'),
      after: null,
      limit: 10,
      scope: { kind: 'organization', organizationId: ORG },
    })
  )
    .filter((inspection) => inspection.reviewId === id)
    .map((inspection) => inspection.shadowFindings)

const bindingComparisons = (id: ReviewId, revisions: number[]) =>
  getDb().transaction(async (tx) => [
    ...(
      await selectRevisionBindingComparisons(
        tx,
        { organizationId: ORG, reviewId: id },
        revisions,
      )
    ).entries(),
  ])

const restated = () =>
  createRestatedRevisionQuery(getDb()).listRestatedRevisions({
    organizationId: ORG,
    propertyId: PROPERTY,
  })

const retention = () => createObservationRetention(getDb())

beforeEach(async () => {
  keys = 0
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Observation retention', 'review-observation-retention', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('the repeat prune', () => {
  const T0 = new Date('2026-10-16T00:00:00.000Z')
  const at = (hours: number) => new Date(T0.getTime() + hours * HOUR_MS)
  const EDIT = {
    rating: 2 as const,
    text: 'Noisy at night',
    sourceUpdatedAt: new Date('2026-10-17T00:00:00.000Z'),
  }

  /** Review A as the old writer left it: real changes with repeats between. */
  async function seedHistory(): Promise<void> {
    await recordedRead(readOf(REVIEW_A, at(0))) // 1 initial
    await appendRepeats(REVIEW_A, [at(6), at(12)]) // 2, 3
    await quietRead(readOf(REVIEW_A, at(18), { translatedText: 'Chambre calme' })) // 4
    await appendRepeats(REVIEW_A, [at(24), at(30)]) // 5, 6
    await recordedRead(readOf(REVIEW_A, at(36), EDIT)) // 7 edit
    await quietRead(readOf(REVIEW_A, at(37))) // 8 an older read, out of order
    await quietRead(readOf(REVIEW_A, at(42), EDIT)) // 9 the edit again
    await appendRepeats(REVIEW_A, [at(48), at(54)]) // 10, 11
  }

  it('deletes only the repeats, and every reader keeps its answer', async () => {
    await seedHistory()
    expect(await sequencesOf(REVIEW_A)).toEqual([
      [1, 'initial_material_revision'],
      [2, 'unchanged'],
      [3, 'unchanged'],
      [4, 'unchanged'],
      [5, 'unchanged'],
      [6, 'unchanged'],
      [7, 'material_change'],
      [8, 'out_of_order_ignored'],
      [9, 'unchanged'],
      [10, 'unchanged'],
      [11, 'unchanged'],
    ])
    const bindingsBefore = await bindingComparisons(REVIEW_A, [1, 2])
    const findingsBefore = await lifecycleFindings(REVIEW_A)

    const pruned = await retention().pruneRepeats({
      after: null,
      limit: 200,
      scope: SCOPE,
    })

    expect(pruned).toEqual({ reviews: 1, observations: 11, repeats: 6, last: REVIEW_A })
    expect(await sequencesOf(REVIEW_A)).toEqual([
      [1, 'initial_material_revision'],
      [4, 'unchanged'],
      [7, 'material_change'],
      [8, 'out_of_order_ignored'],
      [11, 'unchanged'],
    ])
    expect(await bindingComparisons(REVIEW_A, [1, 2])).toEqual(bindingsBefore)
    expect(bindingsBefore).toEqual([
      [1, 'initial_material_revision'],
      [2, 'material_change'],
    ])
    expect(await lifecycleFindings(REVIEW_A)).toEqual(findingsBefore)
    expect(findingsBefore).toEqual([[]])
  })

  it('keeps a restated revision listed: the row before it keeps its updateTime', async () => {
    // A revision recorded before the restatement rule: Google moved nothing,
    // yet the old comparison saw a change (ADR 0055, note 2026-10-23).
    await recordedRead(readOf(REVIEW_B, at(0)))
    await appendRepeats(REVIEW_B, [at(6), at(12)])
    await recordedRead(readOf(REVIEW_B, at(18), EDIT))
    await getPool().query(
      `UPDATE review_source_observations SET source_updated_at = $3
        WHERE organization_id = $1 AND review_id = $2 AND observation_sequence = 4`,
      [ORG, REVIEW_B, new Date('2026-08-01T12:00:00.000Z')],
    )
    await appendRepeats(REVIEW_B, [at(24), at(30)])
    const before = await restated()
    expect(before).toEqual([{ reviewId: REVIEW_B, sourceEpoch: 0, revision: 2 }])

    const pruned = await retention().pruneRepeats({
      after: null,
      limit: 200,
      scope: SCOPE,
    })

    expect(pruned.repeats).toBe(3)
    expect((await sequencesOf(REVIEW_B)).map(([sequence]) => sequence)).toEqual([1, 4, 6])
    expect(await restated()).toEqual(before)
  })

  it('counts without deleting, and a second prune finds nothing', async () => {
    await seedHistory()

    const scanned = await retention().scanRepeats({
      after: null,
      limit: 200,
      scope: SCOPE,
    })

    expect(scanned).toEqual({ reviews: 1, observations: 11, repeats: 6, last: REVIEW_A })
    expect(await rowsOf(REVIEW_A)).toHaveLength(11)
    await retention().pruneRepeats({ after: null, limit: 200, scope: SCOPE })
    expect(
      await retention().pruneRepeats({ after: null, limit: 200, scope: SCOPE }),
    ).toEqual({ reviews: 1, observations: 5, repeats: 0, last: REVIEW_A })
  })

  it('walks the Reviews in id order, one batch after another', async () => {
    await recordedRead(readOf(REVIEW_A, at(0)))
    await appendRepeats(REVIEW_A, [at(6), at(12)])
    await recordedRead(readOf(REVIEW_B, at(0)))
    await appendRepeats(REVIEW_B, [at(6), at(12), at(18)])

    const first = await retention().pruneRepeats({ after: null, limit: 1, scope: SCOPE })
    const second = await retention().pruneRepeats({
      after: first.last,
      limit: 1,
      scope: SCOPE,
    })
    const done = await retention().pruneRepeats({
      after: second.last,
      limit: 1,
      scope: SCOPE,
    })

    expect(first).toEqual({ reviews: 1, observations: 3, repeats: 1, last: REVIEW_A })
    expect(second).toEqual({ reviews: 1, observations: 4, repeats: 2, last: REVIEW_B })
    expect(done).toEqual({ reviews: 0, observations: 0, repeats: 0, last: null })
  })

  it('prunes the repeats of an erased Review and keeps its newest row', async () => {
    await recordedRead(readOf(REVIEW_A, at(0)))
    await appendRepeats(REVIEW_A, [at(6), at(12)])
    await getDb().transaction((tx) =>
      eraseReviewSourceContent(tx, {
        reviewId: REVIEW_A,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        expectedSourceRevision: 1,
        state: 'provider_deleted',
      }),
    )

    const pruned = await retention().pruneRepeats({
      after: null,
      limit: 200,
      scope: SCOPE,
    })

    expect(pruned.repeats).toBe(1)
    expect((await rowsOf(REVIEW_A)).map((row) => [row.sequence, row.state])).toEqual([
      [1, 'provider_deleted'],
      [3, 'provider_deleted'],
    ])
  })

  it('refuses a batch size it was not built for', async () => {
    await expect(
      retention().pruneRepeats({ after: null, limit: 201, scope: SCOPE }),
    ).rejects.toThrow('Repeat batch size must be between 1 and 200')
  })
})

describe('the superseded-copy redaction', () => {
  // The database decides what has expired (`transaction_timestamp()`), so the
  // reads are placed before the real now.
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

  /** Review A: two superseded copies past their clock, a newest one inside it.
   * Review B: only its newest row, whose clock has passed. */
  async function seedCopies(): Promise<void> {
    await recordedRead(readOf(REVIEW_A, daysAgo(70)))
    await quietRead(readOf(REVIEW_A, daysAgo(50), { translatedText: 'Chambre calme' }))
    await recordedRead(
      readOf(REVIEW_A, daysAgo(10), {
        rating: 2,
        text: 'Noisy at night',
        sourceUpdatedAt: daysAgo(11),
      }),
    )
    await recordedRead(readOf(REVIEW_B, daysAgo(45)))
  }

  it('blanks the content of superseded copies past their clock and nothing else', async () => {
    await seedCopies()
    const before = await rowsOf(REVIEW_A)

    const redacted = await retention().redactExpiredSupersededCopies({
      limit: 500,
      scope: SCOPE,
    })

    expect(redacted).toBe(2)
    const after = await rowsOf(REVIEW_A)
    expect(after.map((row) => [row.sequence, row.state, row.text, row.rating])).toEqual([
      [1, 'source_expired', null, null],
      [2, 'source_expired', null, null],
      [3, 'active', 'Noisy at night', 2],
    ])
    // History keeps what its readers use: digests and comparisons.
    expect(after.map((row) => [row.digest, row.comparison])).toEqual(
      before.map((row) => [row.digest, row.comparison]),
    )
    expect(await lifecycleFindings(REVIEW_A)).toEqual([[]])
    expect(await bindingComparisons(REVIEW_A, [1, 2])).toEqual([
      [1, 'initial_material_revision'],
      [2, 'material_change'],
    ])
    // The newest row is the Review's current content: the Review lifecycle's.
    expect((await rowsOf(REVIEW_B)).map((row) => [row.sequence, row.state])).toEqual([
      [1, 'active'],
    ])
    await expect(
      retention().redactExpiredSupersededCopies({ limit: 500, scope: SCOPE }),
    ).resolves.toBe(0)
  })

  it('sweeps in batches up to its cap', async () => {
    await seedCopies()

    const capped = await retention().sweepExpiredSupersededCopies({
      batchSize: 1,
      maxBatches: 1,
      scope: SCOPE,
    })
    const rest = await retention().sweepExpiredSupersededCopies({
      batchSize: 1,
      maxBatches: 5,
      scope: SCOPE,
    })

    expect(capped).toEqual({ batches: 1, processed: 1, capped: true })
    expect(rest).toEqual({ batches: 1, processed: 1, capped: false })
    // The copy whose clock ran out first goes first.
    expect((await rowsOf(REVIEW_A)).map((row) => row.state)).toEqual([
      'source_expired',
      'source_expired',
      'active',
    ])
  })
})
