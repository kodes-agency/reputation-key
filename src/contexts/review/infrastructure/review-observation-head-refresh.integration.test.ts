import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewRepository } from './repositories/review.repository'
import { createReviewSourceContentLifecycleStore } from './repositories/source-content-lifecycle-store.repository'
import { eraseReviewSourceContent } from './review-source-content-store'

// Each snapshot pass reads every review of a Property twice. Until 2026-10-24
// each read wrote a full-text `review_source_observations` row, so a review
// nobody touched collected one copy of its text per pass: 3.4M rows for 12,599
// reviews on the beta, 99.3% of them a repeat of the row before. A re-read that
// matches the newest row now moves that row's 30-day content clock and writes
// nothing else; anything Google reports differently still writes a row.

const ORG = organizationId('review-head-refresh-org-a')
const OTHER_ORG = organizationId('review-head-refresh-org-b')
const PROPERTY = propertyId('f9b40000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9b40000-0000-4000-8000-000000000002')
const FIRST_READ = new Date('2026-10-24T06:00:00.000Z')
const UPDATED_AT = new Date('2026-10-01T12:00:00.000Z')
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
const expiresAt = (hours: number) => new Date(fetchedAt(hours).getTime() + CONTENT_TTL_MS)

/** What Google returns for the review, as read `hours` after the first read. */
function readAt(hours: number, overrides: Partial<ReviewWrite> = {}): ReviewWrite {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-head-refresh',
    externalLocationId: 'locations/head-refresh',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Quiet room, friendly staff',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: UPDATED_AT,
    expiresAt: new Date('2027-10-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: UPDATED_AT,
    sourceUpdatedAt: UPDATED_AT,
    firstFetchedAt: FIRST_READ,
    lastFetchedAt: fetchedAt(hours),
    contentExpiresAt: expiresAt(hours),
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

const keyOf = (read: number) => read.toString(16).padStart(64, '0')

/** A read whose AI source changed (or a first sighting): the recorded path. */
function recordedRead(candidate: ReviewWrite, read: number) {
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
    keyOf(read),
    'ongoing',
    undefined,
    true,
  )
}

/** A read whose AI source is unchanged: the quiet refresh path the sync takes. */
function quietRead(candidate: ReviewWrite, read: number) {
  const observedAt = candidate.lastFetchedAt!
  return createReviewRepository(getDb(), () => observedAt).upsert(
    candidate,
    observedAt,
    keyOf(read),
    'ongoing',
    true,
  )
}

type ObservationRow = Readonly<{
  sequence: number
  revision: number
  comparison: string
  state: string
  observedAt: Date
  contentExpiresAt: Date
  updatedAt: Date
}>

const observations = async (): Promise<ObservationRow[]> =>
  (
    await getPool().query<ObservationRow>(
      `SELECT observation_sequence::int AS sequence, material_revision::int AS revision,
              comparison_result AS comparison, content_state AS state,
              observed_at AS "observedAt", content_expires_at AS "contentExpiresAt",
              updated_at AS "updatedAt"
         FROM review_source_observations
        WHERE organization_id = $1 AND review_id = $2
        ORDER BY observation_sequence`,
      [ORG, REVIEW],
    )
  ).rows

const sequences = async () =>
  (await observations()).map((row) => [row.sequence, row.revision, row.comparison])

const storedReview = async () =>
  (
    await getPool().query<{
      sequence: number
      lastFetchedAt: Date
      contentExpiresAt: Date
      sourceClock: Date
    }>(
      `SELECT r.source_observation_sequence::int AS sequence,
              r.last_fetched_at AS "lastFetchedAt", r.content_expires_at AS "contentExpiresAt",
              c.content_expires_at AS "sourceClock"
         FROM reviews r JOIN review_source_contents c ON c.review_id = r.id
        WHERE r.organization_id = $1 AND r.id = $2`,
      [ORG, REVIEW],
    )
  ).rows[0]

const lifecycleFindings = async (evaluatedAt: Date) =>
  (
    await createReviewSourceContentLifecycleStore(getDb()).readInspectionBatch({
      evaluatedAt,
      after: null,
      limit: 10,
      scope: { kind: 'organization', organizationId: ORG },
    })
  ).map((inspection) => inspection.shadowFindings)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Head refresh property', 'review-head-refresh-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('re-reading a review Google has not changed', () => {
  it('writes no row and moves the newest row’s content clock to the new fetch', async () => {
    await recordedRead(readAt(0), 1)

    await quietRead(readAt(6), 2)
    await quietRead(readAt(12), 3)

    const rows = await observations()
    expect(rows.map((row) => [row.sequence, row.comparison])).toEqual([
      [1, 'initial_material_revision'],
    ])
    expect(rows[0]!.observedAt).toEqual(fetchedAt(0))
    expect(rows[0]!.contentExpiresAt).toEqual(expiresAt(12))
    expect(rows[0]!.updatedAt).toEqual(fetchedAt(12))
    expect(await storedReview()).toEqual({
      sequence: 1,
      lastFetchedAt: fetchedAt(12),
      contentExpiresAt: expiresAt(12),
      sourceClock: expiresAt(12),
    })
  })

  it('leaves the lifecycle inspection matching the newest row', async () => {
    await recordedRead(readAt(0), 1)
    await quietRead(readAt(6), 2)

    expect(await lifecycleFindings(fetchedAt(6))).toEqual([[]])
  })

  it('refreshes in place on the recorded path too', async () => {
    await recordedRead(readAt(0), 1)

    const reread = await recordedRead(readAt(6), 2)

    expect(reread.sourceRevision).toBe(1)
    expect(await sequences()).toEqual([[1, 1, 'initial_material_revision']])
    expect((await observations())[0]!.contentExpiresAt).toEqual(expiresAt(6))
  })

  it('answers a replayed key from the row it wrote, without moving the clock', async () => {
    await recordedRead(readAt(0), 1)

    await quietRead(readAt(6), 1)

    expect(await sequences()).toEqual([[1, 1, 'initial_material_revision']])
    expect((await observations())[0]!.contentExpiresAt).toEqual(expiresAt(0))
  })
})

describe('re-reading a review Google reports differently', () => {
  it('writes a row when only the translation changed', async () => {
    await recordedRead(readAt(0), 1)

    await quietRead(readAt(6, { translatedText: 'Chambre calme' }), 2)
    await quietRead(readAt(12, { translatedText: 'Chambre calme' }), 3)

    expect(await sequences()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 1, 'unchanged'],
    ])
    const [first, second] = await observations()
    // The superseded copy keeps the clock of the last fetch that returned it.
    expect(first!.contentExpiresAt).toEqual(expiresAt(0))
    expect(second!.contentExpiresAt).toEqual(expiresAt(12))
    expect(await lifecycleFindings(fetchedAt(12))).toEqual([[]])
  })

  it('writes a row when only Google’s updateTime moved', async () => {
    await recordedRead(readAt(0), 1)

    await quietRead(readAt(6, { sourceUpdatedAt: fetchedAt(5) }), 2)

    expect(await sequences()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 1, 'unchanged'],
    ])
  })

  it('writes a row for a guest edit, then refreshes that row', async () => {
    await recordedRead(readAt(0), 1)
    const edit = {
      rating: 2 as const,
      text: 'Noisy at night',
      sourceUpdatedAt: fetchedAt(5),
    }

    const edited = await recordedRead(readAt(6, edit), 2)
    await quietRead(readAt(12, edit), 3)

    expect(edited.sourceRevision).toBe(2)
    expect(await sequences()).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 2, 'material_change'],
    ])
    expect((await observations())[1]!.contentExpiresAt).toEqual(expiresAt(12))
  })

  it('writes a row when Google shows a review whose content was erased', async () => {
    await recordedRead(readAt(0), 1)
    await getDb().transaction((tx) =>
      eraseReviewSourceContent(tx, {
        reviewId: REVIEW,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        expectedSourceRevision: 1,
        state: 'provider_deleted',
      }),
    )

    await quietRead(readAt(6), 2)

    const rows = await observations()
    expect(rows.map((row) => [row.sequence, row.state])).toEqual([
      [1, 'provider_deleted'],
      [2, 'active'],
    ])
    expect((await storedReview())!.sequence).toBe(2)
  })
})
