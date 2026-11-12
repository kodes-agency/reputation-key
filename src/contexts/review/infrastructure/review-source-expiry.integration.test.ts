import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

const ORG = organizationId('review-expiry-org-a')
const OTHER_ORG = organizationId('review-expiry-org-b')
const PROPERTY = propertyId('f9a40000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9a40000-0000-4000-8000-000000000002')
const FIRST_FETCH = new Date('2026-10-23T04:35:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const TTL_MS = 30 * DAY_MS
const UPDATED_AT = new Date('2026-08-01T12:00:00.000Z')

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

function review(
  overrides: Partial<Omit<Review, 'createdAt' | 'updatedAt'>> = {},
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-expiry',
    externalLocationId: 'locations/expiry',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Original review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: UPDATED_AT,
    firstFetchedAt: new Date('2026-08-01T12:00:00.000Z'),
    lastFetchedAt: FIRST_FETCH,
    contentExpiresAt: new Date(FIRST_FETCH.getTime() + TTL_MS),
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 15,
    aiSourceDigest: 'a'.repeat(64),
    ...overrides,
  }
}

const announce = (persisted: Review) =>
  (persisted.analysisSequence === 1 ? reviewCreated : reviewUpdated)({
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt: FIRST_FETCH,
  })

/** A real fetch at `fetchedAt`, as the sync builds it: expiry 30 days on. */
function fetchAt(fetchedAt: Date, overrides: Partial<Review> = {}) {
  const candidate = review({
    lastFetchedAt: fetchedAt,
    contentExpiresAt: new Date(fetchedAt.getTime() + TTL_MS),
    ...overrides,
  })
  return createAtomicReviewCommandStore(
    getDb(),
    () => fetchedAt,
    undefined,
    undefined,
    replyScopeEffects,
  ).upsertAndRecord(
    candidate,
    announce,
    fetchedAt,
    String(fetchedAt.getTime()).padStart(64, '0'),
    'ongoing',
    undefined,
    undefined,
  )
}

type Clocks = {
  contentExpiry: number
  contentFetched: number
  newestObservationExpiry: number
  observationRows: number
}

async function clocks(): Promise<Clocks> {
  const content = await getPool().query<{ expiry: Date; fetched: Date }>(
    `SELECT content_expires_at AS expiry, last_fetched_at AS fetched
       FROM review_source_contents WHERE review_id = $1 AND organization_id = $2`,
    [REVIEW, ORG],
  )
  const observations = await getPool().query<{ expiry: Date }>(
    `SELECT content_expires_at AS expiry FROM review_source_observations
      WHERE review_id = $1 AND organization_id = $2 ORDER BY observation_sequence DESC`,
    [REVIEW, ORG],
  )
  const contentRow = content.rows[0]!
  return {
    contentExpiry: contentRow.expiry.getTime(),
    contentFetched: contentRow.fetched.getTime(),
    newestObservationExpiry: observations.rows[0]!.expiry.getTime(),
    observationRows: observations.rows.length,
  }
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Expiry property', 'review-expiry-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('the Google content clock moves at most once a day', () => {
  it('keeps both expiries and last_fetched_at for a re-read inside a day', async () => {
    await fetchAt(FIRST_FETCH)
    const first = await clocks()

    await fetchAt(new Date(FIRST_FETCH.getTime() + DAY_MS - 1))
    const again = await clocks()

    expect(again).toEqual(first)
    expect(again.contentFetched).toBe(FIRST_FETCH.getTime())
    expect(again.contentExpiry).toBe(FIRST_FETCH.getTime() + TTL_MS)
  })

  it('moves both tables together on a read a day or more later', async () => {
    await fetchAt(FIRST_FETCH)
    const later = new Date(FIRST_FETCH.getTime() + DAY_MS)

    await fetchAt(later)
    const moved = await clocks()

    expect(moved.contentFetched).toBe(later.getTime())
    expect(moved.contentExpiry).toBe(later.getTime() + TTL_MS)
    expect(moved.newestObservationExpiry).toBe(moved.contentExpiry)
    expect(moved.observationRows).toBe(1)
  })

  it('keeps the newest observation and the content row on one expiry when the content changes', async () => {
    await fetchAt(FIRST_FETCH)
    await fetchAt(new Date(FIRST_FETCH.getTime() + 1000), { text: 'Edited review' })
    const inside = await clocks()
    expect(inside.observationRows).toBe(2)
    expect(inside.newestObservationExpiry).toBe(inside.contentExpiry)
    expect(inside.contentExpiry).toBe(FIRST_FETCH.getTime() + TTL_MS)

    const later = new Date(FIRST_FETCH.getTime() + 3 * DAY_MS)
    await fetchAt(later, { text: 'Edited again' })
    const after = await clocks()
    expect(after.newestObservationExpiry).toBe(after.contentExpiry)
    expect(after.contentExpiry).toBe(later.getTime() + TTL_MS)
  })

  it('never lets a copy outlive 30 days from a fetch', async () => {
    const fetches = [0, 1000, DAY_MS / 2, DAY_MS, DAY_MS + 5, 2 * DAY_MS + 9, 40 * DAY_MS]
    for (const offset of fetches) {
      const at = new Date(FIRST_FETCH.getTime() + offset)
      await fetchAt(at)
      const state = await clocks()
      expect(state.contentExpiry).toBeLessThanOrEqual(at.getTime() + TTL_MS)
      expect(state.contentExpiry).toBeGreaterThan(at.getTime())
      expect(state.contentExpiry - state.contentFetched).toBe(TTL_MS)
      expect(state.newestObservationExpiry).toBe(state.contentExpiry)
    }
  })
})
