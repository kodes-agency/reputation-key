import {
  eraseReviewSourceContent,
  replyScopeEffects,
} from '#/contexts/reputation/application/public-api'
import { beforeEach, describe, expect, it } from 'vitest'
import { createReviewRepository } from './repositories/review.repository'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

// A re-read of content the store already holds must leave the content row
// untouched: no new row version, no new updated_at. A changed value, a moved
// clock or a missing row still writes.

const ORG = organizationId('review-content-unchanged-org-a')
const OTHER_ORG = organizationId('review-content-unchanged-org-b')
const PROPERTY = propertyId('f9c60000-0000-4000-8000-000000000001')
const REVIEW = reviewId('f9c60000-0000-4000-8000-000000000002')
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
    externalId: 'provider-review-content-unchanged',
    externalLocationId: 'locations/content-unchanged',
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

const keyOf = (read: number) => read.toString(16).padStart(64, '0')

function read(candidate: ReviewWrite, key: number) {
  const observedAt = candidate.lastFetchedAt!
  return createReviewRepository(
    getDb(),
    () => observedAt,
    undefined,
    replyScopeEffects,
  ).upsert(candidate, observedAt, keyOf(key), 'ongoing', true)
}

type ContentStamp = Readonly<{
  version: string
  updatedAt: Date
  lastFetchedAt: Date
  contentExpiresAt: Date
}>

async function contentRow(): Promise<ContentStamp | null> {
  const result = await getPool().query<ContentStamp>(
    `SELECT xmin::text AS version, updated_at AS "updatedAt",
            last_fetched_at AS "lastFetchedAt", content_expires_at AS "contentExpiresAt"
       FROM review_source_contents WHERE organization_id = $1 AND review_id = $2`,
    [ORG, REVIEW],
  )
  return result.rows[0] ?? null
}

async function headExpiry(): Promise<Date[]> {
  const result = await getPool().query<{ expiresAt: Date }>(
    `SELECT content_expires_at AS "expiresAt" FROM review_source_observations
      WHERE organization_id = $1 AND review_id = $2
      ORDER BY observation_sequence DESC LIMIT 1`,
    [ORG, REVIEW],
  )
  return result.rows.map((row) => row.expiresAt)
}

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Content unchanged property', 'review-content-unchanged-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('re-reading content the store already holds', () => {
  it('leaves the content row byte-identical within a day', async () => {
    await read(readAt(0), 1)
    const before = await contentRow()

    await read(readAt(6), 2)
    await read(readAt(12), 3)

    expect(before).not.toBeNull()
    expect(await contentRow()).toEqual(before)
  })

  it('moves the content clock with the newest observation a day later', async () => {
    await read(readAt(0), 1)
    const before = await contentRow()

    await read(readAt(24), 2)

    const after = await contentRow()
    expect(after!.version).not.toBe(before!.version)
    expect(after!.lastFetchedAt).toEqual(fetchedAt(24))
    expect(after!.contentExpiresAt).toEqual(readAt(24).contentExpiresAt)
    expect(await headExpiry()).toEqual([after!.contentExpiresAt])
  })

  it('keeps the content row and the newest observation on one expiry within a day', async () => {
    await read(readAt(0), 1)
    await read(readAt(6), 2)

    expect(await headExpiry()).toEqual([(await contentRow())!.contentExpiresAt])
  })

  it('writes the row again when a read changes a value', async () => {
    await read(readAt(0), 1)
    const before = await contentRow()

    await read({ ...readAt(6), contentHash: 'content-v2' }, 2)

    const after = await contentRow()
    expect(after!.version).not.toBe(before!.version)
    const stored = await getPool().query<{ hash: string }>(
      `SELECT content_hash AS hash FROM review_source_contents
        WHERE organization_id = $1 AND review_id = $2`,
      [ORG, REVIEW],
    )
    expect(stored.rows[0]!.hash).toBe('content-v2')
  })

  // Each case changes the read in one column the upsert sets.
  const changedReads: ReadonlyArray<readonly [string, Partial<ReviewWrite>]> = [
    ['rating', { rating: 2 }],
    ['text', { text: 'Noisy room' }],
    ['translatedText', { translatedText: 'Quiet room' }],
    ['languageCode', { languageCode: 'de' }],
    ['reviewerName', { reviewerName: 'Someone else' }],
    [
      'reviewerProfilePhotoUrl',
      { reviewerProfilePhotoUrl: 'https://example.test/p.png' },
    ],
    ['googleReviewUrl', { googleReviewUrl: 'https://example.test/review' }],
    ['reviewedAt', { reviewedAt: new Date('2026-11-02T12:00:00.000Z') }],
    ['sourceCreatedAt', { sourceCreatedAt: new Date('2026-11-02T12:00:00.000Z') }],
    ['sourceUpdatedAt', { sourceUpdatedAt: new Date('2026-11-03T12:00:00.000Z') }],
    ['externalLocationId', { externalLocationId: 'locations/moved' }],
    ['contentHash', { contentHash: 'content-v2' }],
    ['aiSourceByteLength', { aiSourceByteLength: 40 }],
    ['aiSourceDigest', { aiSourceDigest: 'b'.repeat(64) }],
  ]
  it.each(changedReads)('writes the row again when %s changes', async (_name, change) => {
    await read(readAt(0), 1)
    const before = await contentRow()

    await read({ ...readAt(6), ...change }, 2)

    expect((await contentRow())!.version).not.toBe(before!.version)
  })

  // Each case damages one stored column; the next read must put it right.
  const storedColumns: ReadonlyArray<readonly [string, string]> = [
    ['external_location_id', `'locations/other'`],
    ['reviewer_name', `'Stored other'`],
    ['reviewer_profile_photo_url', `'https://example.test/stored.png'`],
    ['google_review_url', `'https://example.test/stored'`],
    ['translated_text', `'stored translation'`],
    ['language_code', `'fr'`],
    ['source_created_at', `'2026-10-01T00:00:00Z'`],
    ['first_fetched_at', `'2026-10-01T00:00:00Z'`],
    ['content_expires_at', `'2026-10-02T00:00:00Z'`],
    ['content_hash', `'stored-other'`],
    ['source_revision', '2'],
    ['ai_source_byte_length', '99'],
    ['ai_source_digest', `'${'c'.repeat(64)}'`],
  ]
  it.each(storedColumns)(
    'writes the row again when stored %s differs',
    async (column, value) => {
      await read(readAt(0), 1)
      await getPool().query(
        `UPDATE review_source_contents SET ${column} = ${value}
          WHERE organization_id = $1 AND review_id = $2`,
        [ORG, REVIEW],
      )
      const before = await contentRow()

      await read(readAt(6), 2)

      expect((await contentRow())!.version).not.toBe(before!.version)
    },
  )

  it('creates the row again after erasure', async () => {
    await read(readAt(0), 1)
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
    expect(await contentRow()).toBeNull()

    await read(readAt(6), 2)

    expect(await contentRow()).not.toBeNull()
  })
})
