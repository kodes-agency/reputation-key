// A Review's own page on Google (`reviewReplyUrl`, "Open on Google") against
// real PostgreSQL, through the real sync observation writer.
//
// The link is provider cache data (ADR 0031): it is written with the erasable
// source content and its REV-01 compatibility copy, on every applied fetch —
// the quiet same-content refresh that extends the content clock included, which
// is how existing Reviews get one without a backfill — and it is erased with
// them. It is in no digest and no observation, so a link appearing or going
// away never makes a Review look changed. It is served only through the
// eligible read.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  reviewId,
  type ReviewId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '../../../../test-fixtures/generated/google-provider-identifiers-v1'
import { createEligibleReads } from '../application/eligible-reads'
import type { GoogleReviewRead } from '../application/ports/google-review-api.port'
import type { ReviewProviderSubjectCandidates } from '../application/ports/review-provider-observation-writer.port'
import { createReviewProviderObservationWriter } from '../application/use-cases/sync-reviews'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createReviewSourceContentLifecycleStore } from './repositories/source-content-lifecycle-store.repository'
import { createReviewRepository } from './repositories/review.repository'
import { createAtomicReviewCommandStore } from './review-command-store'
import { eraseReviewSourceContent } from './review-source-content-store'

const ORG = organizationId('review-google-page-org-a')
const OTHER_ORG = organizationId('review-google-page-org-b')
// Ids no other suite uses: suites share one database, and a Property row left
// under another Organization breaks the other suite's insert.
const PROPERTY = propertyId('c7a90000-0000-4000-8000-000000000001')
const CONNECTION = googleConnectionId('c7a90000-0000-4000-8000-0000000000c1')
const DAY_MS = 24 * 60 * 60 * 1000

/** Synthetic only (test-fixtures/google-provider-identifiers-v1.json). */
const REVIEW_PAGE = `https://business.google.com/n/${GOOGLE_REVIEW_PRIMARY_SEGMENTS.locationId}/reviews/repkey-synthetic-do-not-use-reply-token-0001`
const LATER_PAGE = REVIEW_PAGE.replace(/0001$/u, '0002')

const FIRST_FETCH = new Date('2026-10-01T09:00:00.000Z')
const REFRESH = new Date('2026-10-08T09:00:00.000Z')
const LATER_REFRESH = new Date('2026-10-15T09:00:00.000Z')

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
    'review_ai_analysis_heads',
    'reviews',
    'google_connections',
    'properties',
  ],
})

const db = getDb()
let now = FIRST_FETCH
const reviewRepo = createReviewRepository(db, () => now)

// Stable provider subjects are the snapshot's concern; this Review is always
// found by its external id, so no subject is ever matched here.
const writer = createReviewProviderObservationWriter({
  reviewRepo: { ...reviewRepo, findStableIdentityByProviderSubjects: async () => null },
  clock: () => now,
  idGen: () => reviewId(crypto.randomUUID()),
  commandStore: createAtomicReviewCommandStore(db, () => now),
  googleReplyObservationStore: createGoogleReplyObservationStore(db),
  historyCutoffs: { readHistoryCutoff: async () => null },
})

const REVIEWED_AT = new Date('2026-09-30T18:00:00.000Z')

function providerReview(
  googleReviewUrl: string | null,
  reviewedAt: Date,
  content: Partial<GoogleReviewRead> = {},
): GoogleReviewRead {
  return {
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl,
    rating: 4,
    text: 'Quiet room, lovely breakfast.',
    translatedText: null,
    languageCode: null,
    reviewedAt,
    sourceCreatedAt: reviewedAt,
    sourceUpdatedAt: null,
    replyText: null,
    replyUpdatedAt: null,
    replyUnreadable: false,
    ...content,
  }
}

/** One applied fetch of the review at `at`, as a sync page records it. */
async function observe(
  at: Date,
  googleReviewUrl: string | null,
  reviewedAt: Date = REVIEWED_AT,
  content: Partial<GoogleReviewRead> = {},
): Promise<ReviewId> {
  now = at
  const persisted = await writer.persist({
    organizationId: ORG,
    propertyId: PROPERTY,
    connectionId: CONNECTION,
    sourceEpoch: 0,
    observationOrigin: 'ongoing',
    firstSeenVia: 'snapshot',
    observationKey: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    replyReadGeneration: await writer.allocateReplyReadGeneration(),
    review: providerReview(googleReviewUrl, reviewedAt, content),
    subjects: [] as unknown as ReviewProviderSubjectCandidates,
  })
  return persisted.reviewId
}

type StoredPage = Readonly<{
  compatibility: string | null
  sourceCache: string | null | undefined
  contentExpiresAt: Date | null
  sourceRevision: number
}>

async function stored(id: ReviewId): Promise<StoredPage> {
  const result = await getPool().query<{
    compatibility: string | null
    source_cache: string | null
    has_source_cache: boolean
    content_expires_at: Date | null
    source_revision: string
  }>(
    `SELECT r.google_review_url AS compatibility,
            c.google_review_url AS source_cache,
            c.review_id IS NOT NULL AS has_source_cache,
            r.content_expires_at, r.source_revision
     FROM reviews r
     LEFT JOIN review_source_contents c ON c.review_id = r.id
     WHERE r.id = $1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Review not stored')
  return {
    compatibility: row.compatibility,
    sourceCache: row.has_source_cache ? row.source_cache : undefined,
    contentExpiresAt: row.content_expires_at,
    sourceRevision: Number(row.source_revision),
  }
}

async function observationsOf(id: ReviewId) {
  const result = await getPool().query<{
    observation_digest: string
    comparison_result: string
    material_revision: string
    row: string
  }>(
    `SELECT observation_digest, comparison_result, material_revision,
            row_to_json(o)::text AS row
     FROM review_source_observations o
     WHERE review_id = $1 ORDER BY observation_sequence`,
    [id],
  )
  return result.rows
}

async function reviewFacts(): Promise<readonly string[]> {
  const result = await getPool().query<{ event_type: string }>(
    `SELECT event_type FROM outbox_events
     WHERE organization_id = $1 AND event_type LIKE 'review.%'
     ORDER BY created_at, id`,
    [ORG],
  )
  return result.rows.map((row) => row.event_type)
}

const lifecycleStore = createReviewSourceContentLifecycleStore(db)
const findingsFor = async (id: ReviewId) => {
  const rows = await lifecycleStore.readInspectionBatch({
    evaluatedAt: new Date('2027-01-01T00:00:00.000Z'),
    after: null,
    limit: 10,
    scope: { kind: 'organization', organizationId: ORG },
  })
  return rows.find((row) => row.reviewId === id)?.shadowFindings
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Google page property', 'review-google-page-property', 'UTC', 0)`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status
     ) VALUES (
       $1, $2, 'review-google-page-subject', 'sealed-access', 'sealed-refresh',
       now() + interval '1 hour',
       ARRAY['https://www.googleapis.com/auth/business.manage'],
       'review-google-page-user', 'organization', 'active'
     )`,
    [CONNECTION, ORG],
  )
})

describe.sequential("a Review's own page on Google", () => {
  it('is stored with the source content and its compatibility copy, in parity', async () => {
    const id = await observe(FIRST_FETCH, REVIEW_PAGE)

    await expect(stored(id)).resolves.toMatchObject({
      compatibility: REVIEW_PAGE,
      sourceCache: REVIEW_PAGE,
    })
    await expect(findingsFor(id)).resolves.toEqual([])
  })

  it('is written by the same-content refresh that extends the clock, changing nothing else', async () => {
    const id = await observe(FIRST_FETCH, null)
    const before = await stored(id)
    expect(before.compatibility).toBeNull()

    // An existing Review, refreshed after the deploy: Google now sends a page.
    expect(await observe(REFRESH, REVIEW_PAGE)).toBe(id)

    const after = await stored(id)
    expect(after).toMatchObject({ compatibility: REVIEW_PAGE, sourceCache: REVIEW_PAGE })
    expect(after.contentExpiresAt?.getTime()).toBe(REFRESH.getTime() + 30 * DAY_MS)
    expect(after.contentExpiresAt?.getTime()).toBeGreaterThan(
      before.contentExpiresAt?.getTime() ?? Infinity,
    )
    // Nothing reads as changed: the same revision, the same observation
    // digest, an `unchanged` comparison, and no `review.updated` for the Inbox
    // or the managers' notices.
    expect(after.sourceRevision).toBe(before.sourceRevision)
    const observations = await observationsOf(id)
    expect(observations.map((row) => row.comparison_result)).toEqual([
      'initial_material_revision',
      'unchanged',
    ])
    expect(new Set(observations.map((row) => row.observation_digest)).size).toBe(1)
    expect(new Set(observations.map((row) => row.material_revision)).size).toBe(1)
    expect(observations.some((row) => row.row.includes('business.google.com'))).toBe(
      false,
    )
    await expect(reviewFacts()).resolves.toEqual(['review.created'])
    await expect(findingsFor(id)).resolves.toEqual([])

    // A later fetch carries what Google sends then: another page, then none.
    await observe(LATER_REFRESH, LATER_PAGE)
    await expect(stored(id)).resolves.toMatchObject({
      compatibility: LATER_PAGE,
      sourceCache: LATER_PAGE,
    })
    await observe(new Date(LATER_REFRESH.getTime() + DAY_MS), null)
    await expect(stored(id)).resolves.toMatchObject({
      compatibility: null,
      sourceCache: null,
    })
    await expect(reviewFacts()).resolves.toEqual(['review.created'])
  })

  it('is erased with expired content and stored again by the re-observation', async () => {
    // The database decides that content has expired (`transaction_timestamp()`
    // against `content_expires_at`), so this Review is first fetched more than
    // 30 days before the real now, and seen again after its clock ran out.
    const firstFetch = new Date(Date.now() - 40 * DAY_MS)
    const id = await observe(firstFetch, REVIEW_PAGE, firstFetch)

    // The expired row is redacted (its page with it, or the tombstone CHECK
    // refuses the transaction) before the fresh observation is persisted.
    const reobservedAt = new Date(firstFetch.getTime() + 35 * DAY_MS)
    expect(await observe(reobservedAt, LATER_PAGE, firstFetch)).toBe(id)

    await expect(stored(id)).resolves.toMatchObject({
      compatibility: LATER_PAGE,
      sourceCache: LATER_PAGE,
    })
    await expect(findingsFor(id)).resolves.toEqual([])
    // Outbox rows of one transaction share a timestamp, so compare as a set.
    expect([...(await reviewFacts())].sort()).toEqual([
      'review.created',
      'review.source_transitioned',
      'review.updated',
    ])
  })

  it('is served only while the content is eligible', async () => {
    const id = await observe(FIRST_FETCH, REVIEW_PAGE)
    let readAt = REFRESH
    const reads = createEligibleReads({ reviewRepo, clock: () => readAt })

    const served = await reads.getReviewSnippetById(id, ORG)
    expect(served).toMatchObject({
      status: 'available',
      snippet: { googleReviewUrl: REVIEW_PAGE },
    })

    readAt = new Date(FIRST_FETCH.getTime() + 30 * DAY_MS)
    const expired = await reads.getReviewSnippetById(id, ORG)
    expect(expired).toEqual({ status: 'expired' })
    expect((await reads.getReviewSnippetsByIds([id], ORG)).size).toBe(0)
  })

  it('is erased with the source content, and the database keeps it off a tombstone', async () => {
    const id = await observe(FIRST_FETCH, REVIEW_PAGE)

    const erased = await db.transaction((tx) =>
      eraseReviewSourceContent(tx, {
        reviewId: id,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        expectedSourceRevision: 1,
        state: 'provider_deleted',
      }),
    )
    expect(erased).toBe(true)
    await expect(stored(id)).resolves.toMatchObject({
      compatibility: null,
      sourceCache: undefined,
    })
    await expect(findingsFor(id)).resolves.toEqual([])
    await expect(
      createEligibleReads({ reviewRepo, clock: () => REFRESH }).getReviewSnippetById(
        id,
        ORG,
      ),
    ).resolves.toEqual({ status: 'not_found' })

    await expect(
      getPool().query('UPDATE reviews SET google_review_url = $2 WHERE id = $1', [
        id,
        REVIEW_PAGE,
      ]),
    ).rejects.toThrow(/reviews_source_content_state_valid/)
  })

  it('is part of the shadow-parity comparison of the two copies', async () => {
    const id = await observe(FIRST_FETCH, REVIEW_PAGE)
    await getPool().query(
      'UPDATE review_source_contents SET google_review_url = $2 WHERE review_id = $1',
      [id, LATER_PAGE],
    )

    await expect(findingsFor(id)).resolves.toEqual(['active_compatibility_drift'])
  })
})

describe.sequential("a Review whose text changed, against Google's updateTime", () => {
  const UPDATED = new Date('2026-10-02T08:00:00.000Z')
  const comparisonsOf = async (id: ReviewId) =>
    (await observationsOf(id)).map((row) => [
      Number(row.material_revision),
      row.comparison_result,
    ])

  it('keeps the revision when Google restates the text at the updateTime it reported before', async () => {
    const id = await observe(FIRST_FETCH, null, REVIEWED_AT, { sourceUpdatedAt: UPDATED })

    await observe(REFRESH, null, REVIEWED_AT, {
      sourceUpdatedAt: UPDATED,
      text: 'Quiet room, lovely breakfast, as Google now words it.',
    })

    await expect(comparisonsOf(id)).resolves.toEqual([
      [1, 'initial_material_revision'],
      [1, 'provider_restatement'],
    ])
    await expect(stored(id)).resolves.toMatchObject({ sourceRevision: 1 })
    // The kept revision took the restated digests with the Review: no drift
    // for the lifecycle parity inspection to find.
    await expect(findingsFor(id)).resolves.toEqual([])
  })

  it('counts the change as an edit when Google sent no updateTime to compare', async () => {
    const id = await observe(FIRST_FETCH, null, REVIEWED_AT, { sourceUpdatedAt: UPDATED })

    // Google omitted updateTime. The sync carries the stored one onto the
    // observation, so at the Review store the two times are equal; only what
    // Google reported tells the store there is nothing to compare.
    await observe(REFRESH, null, REVIEWED_AT, {
      sourceUpdatedAt: null,
      text: 'Quiet room, but the corridor was loud.',
    })

    await expect(comparisonsOf(id)).resolves.toEqual([
      [1, 'initial_material_revision'],
      [2, 'material_change'],
    ])
    await expect(stored(id)).resolves.toMatchObject({ sourceRevision: 2 })
  })

  it('counts the change as an edit when Google moved updateTime by a millisecond', async () => {
    const id = await observe(FIRST_FETCH, null, REVIEWED_AT, { sourceUpdatedAt: UPDATED })

    await observe(REFRESH, null, REVIEWED_AT, {
      sourceUpdatedAt: new Date(UPDATED.getTime() + 1),
      text: 'Quiet room, but the corridor was loud.',
    })

    await expect(comparisonsOf(id)).resolves.toEqual([
      [1, 'initial_material_revision'],
      [2, 'material_change'],
    ])
  })
})
