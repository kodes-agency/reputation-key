import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Reply, Review } from '../domain/types'
import { compareObservedGoogleReply } from '../domain/google-reply-observation'
import {
  reviewReplyPublicationCancelled,
  reviewReplyPublicationRequested,
  reviewUpdated,
} from '../domain/events'
import { createReviewRepository } from './repositories/review.repository'
import { createReplyRepository } from './repositories/reply.repository'
import { createAtomicReplyCommandStore } from './reply-command-store'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { eraseReviewSourceContent } from './review-source-content-store'
import type { RecordGoogleReplyObservation } from '../application/ports/google-reply-observation-store.port'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'

const ORG = organizationId('org-rpl-observation-integration')
const PROP_A = propertyId('a1000000-0000-0000-0000-000000000001')
const PROP_B = propertyId('a1000000-0000-0000-0000-000000000002')
const REVIEW_A = reviewId('a1000000-0000-0000-0000-000000000010')
const REVIEW_B = reviewId('a1000000-0000-0000-0000-000000000011')
const REPLY_A = replyId('a1000000-0000-0000-0000-000000000020')
const REPLY_B = replyId('a1000000-0000-0000-0000-000000000021')
const USER = userId('user-rpl-observation-integration')
const NOW = new Date('2026-08-20T12:00:00.000Z')
const EXPIRES = new Date('2026-09-20T12:00:00.000Z')

/** Identity behavior is outside this Review truth-chain fixture. Production
 * composition injects the real transaction-bound authority; these tests grant
 * their one explicitly seeded manager. */
const createTestReplyCommandStore = () =>
  createAtomicReplyCommandStore(
    getDb(),
    () => new Date(),
    async () => true,
  )

let pool: Pool
let lease: TestLease
let nextReadGeneration = 0

function makeReview(
  id: typeof REVIEW_A | typeof REVIEW_B,
  externalId: string,
  property = PROP_A,
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id,
    organizationId: ORG,
    propertyId: property,
    platform: 'google',
    externalId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Observation test guest',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Material review text',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: EXPIRES,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: NOW,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: EXPIRES,
    contentHash: null,
    sourceSeenGeneration: 'a1000000-0000-0000-0000-000000000100',
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
  }
}

function makeReply(
  id: typeof REPLY_A | typeof REPLY_B,
  review: typeof REVIEW_A | typeof REVIEW_B,
): Reply {
  return {
    id,
    reviewId: review,
    organizationId: ORG,
    text: 'Thank you for your review!',
    status: 'pending_approval',
    source: 'internal',
    createdBy: USER,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

async function resetFixture(): Promise<void> {
  nextReadGeneration = 0
  await withPublicationAuthorizationFixtureMutation(() =>
    pool.query(
      'TRUNCATE google_reply_observation_heads, google_reply_observations, reply_publication_attempts, reply_publication_authorizations CASCADE',
    ),
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  const slug = 'rpl-observation-integration'
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'RPL Observation Integration', $2, NOW())`,
    [ORG, slug],
  )
  for (const [id, slugPart] of [
    [PROP_A, 'a'],
    [PROP_B, 'b'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties
        (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())`,
      [id, ORG, `Observation Property ${slugPart}`, `rpl-observation-${slugPart}`],
    )
  }
}

async function seedReviewAndReply(input: {
  reviewId?: typeof REVIEW_A | typeof REVIEW_B
  replyId?: typeof REPLY_A | typeof REPLY_B
  externalId?: string
  propertyId?: typeof PROP_A | typeof PROP_B
  claim?: boolean
  providerPending?: boolean
}) {
  const id = input.reviewId ?? REVIEW_A
  const rId = input.replyId ?? REPLY_A
  const property = input.propertyId ?? PROP_A
  const db = getDb()
  const review = await createReviewRepository(db, () => new Date()).upsert(
    makeReview(id, input.externalId ?? `external-${id}`, property),
    NOW,
    sha256Hex(`review-observation:${id}`),
  )
  const commandStore = createTestReplyCommandStore()
  const originalReply = await createReplyRepository(db, () => new Date()).upsert(
    makeReply(rId, id),
  )
  const authorized = await commandStore.markPublicationAuthorized(
    originalReply,
    { status: 'approved', approvedBy: USER, approvedAt: NOW },
    {
      lifecycleEvent: null,
      publicationIntent: reviewReplyPublicationRequested({
        replyId: rId,
        reviewId: id,
        propertyId: property,
        organizationId: ORG,
        userId: USER,
        publicationCycle: 1,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
        occurredAt: NOW,
      }),
    },
    NOW,
  )
  expect(authorized).not.toBeNull()
  if (input.claim === false) return { review, reply: authorized! }

  const claimed = await commandStore.markPublicationSending(
    authorized!,
    {
      providerOperationKey: `publish:${rId}:1:1`,
      propertyId: property,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      baseObservationRevision: 0,
    },
    NOW,
  )
  expect(claimed).not.toBeNull()
  if (input.providerPending === false) return { review, reply: claimed! }
  const pending = await commandStore.markProviderOutcomePendingObservation(
    claimed!,
    {
      providerCorrelationId: 'provider-correlation-1',
      providerRespondedAt: NOW,
    },
    NOW,
  )
  expect(pending?.publicationState).toBe('pending_observation')
  return { review, reply: pending! }
}

function observationInput(
  review: Review,
  overrides: Record<string, unknown> = {},
): RecordGoogleReplyObservation {
  return {
    organizationId: ORG,
    propertyId: review.propertyId,
    reviewId: review.id,
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    readGeneration: ++nextReadGeneration,
    observationKey: sha256Hex('google-reply-observation-1'),
    source: 'provider_snapshot' as const,
    observedText: 'Thank you for your review!',
    providerUpdatedAt: NOW,
    observedAt: NOW,
    contentExpiresAt: EXPIRES,
    ...overrides,
  } as RecordGoogleReplyObservation
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(resetFixture)

afterAll(async () => {
  await resetFixture()
  clearEventSchemas()
  await lease.release()
})

describe.sequential('Google reply observation authority (real PostgreSQL)', () => {
  it('keeps provider acceptance pending until exact observed text confirms it', async () => {
    const { review, reply } = await seedReviewAndReply({})
    expect(reply.publicationState).toBe('pending_observation')

    const result = await createGoogleReplyObservationStore(getDb()).record(
      observationInput(review),
    )

    expect(result).toMatchObject({
      duplicate: false,
      change: 'added',
      resolution: 'confirmed_on_google',
      matchedReplyId: REPLY_A,
      matchedPublicationCycle: 1,
    })
    const persisted = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(persisted).toMatchObject({
      status: 'published',
      publicationState: 'published',
    })
    const attempt = await pool.query(
      `SELECT outcome, provider_correlation_id, confirmed_observation_revision
       FROM reply_publication_attempts WHERE reply_id = $1`,
      [REPLY_A],
    )
    expect(attempt.rows[0]).toMatchObject({
      outcome: 'confirmed',
      provider_correlation_id: 'provider-correlation-1',
      confirmed_observation_revision: '1',
    })
  })

  it('does not let a redundant re-read supersede the confirming observation', async () => {
    // A snapshot run re-reads every review in its confirmation scan. That
    // second read says nothing new — it records no fact, confirms no attempt,
    // and supersedes nothing. Advancing the head used to revoke the Inbox
    // close permit scoped to the confirming observation, leaving a Published
    // reply whose Inbox item stayed Open.
    const { review } = await seedReviewAndReply({})
    const store = createGoogleReplyObservationStore(getDb())

    const confirming = await store.record(observationInput(review))
    expect(confirming).toMatchObject({
      duplicate: false,
      observationRevision: 1,
      resolution: 'confirmed_on_google',
    })

    // Same provider truth, different idempotency key — a genuine second read.
    const reread = await store.record(
      observationInput(review, {
        observationKey: sha256Hex('google-reply-observation-confirmation-scan'),
      }),
    )
    expect(reread).toMatchObject({ duplicate: true, observationRevision: 1 })

    const head = await pool.query(
      'SELECT observation_revision FROM google_reply_observation_heads WHERE review_id = $1',
      [REVIEW_A],
    )
    expect(head.rows[0].observation_revision).toBe('1')
  })

  it('accepts a same-key/same-evidence replay but refuses changed evidence', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const input = observationInput(review)

    expect(await store.record(input)).toMatchObject({ duplicate: false })
    expect(await store.record(input)).toMatchObject({
      duplicate: true,
      observationRevision: 1,
    })
    await expect(
      store.record({ ...input, observedText: 'Different provider reply' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    const count = await pool.query(
      'SELECT count(*)::int AS n FROM google_reply_observations WHERE review_id = $1',
      [REVIEW_A],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('keeps an exact committed replay idempotent after the Review advances', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const input = observationInput(review, {
      observationKey: sha256Hex('replay-before-material-advance'),
    })
    expect(await store.record(input)).toMatchObject({ duplicate: false })

    const later = new Date(NOW.getTime() + 1_000)
    const advanced = await createReviewRepository(getDb(), () => new Date()).upsert(
      {
        ...makeReview(REVIEW_A, `external-${REVIEW_A}`),
        text: 'A materially changed review',
        sourceUpdatedAt: later,
        lastFetchedAt: later,
        contentExpiresAt: new Date(EXPIRES.getTime() + 1_000),
      },
      later,
      sha256Hex('review-material-observation-2'),
    )
    expect(advanced.sourceRevision).toBe(review.sourceRevision + 1)

    expect(await store.record(input)).toMatchObject({
      duplicate: true,
      observationRevision: 1,
    })
    await expect(
      store.record({ ...input, observedText: 'Changed replay payload' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('validates exact tenant/property ownership before honoring a duplicate key', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const input = observationInput(review)
    await store.record(input)

    await expect(store.record({ ...input, propertyId: PROP_B })).rejects.toMatchObject({
      code: 'review_not_found',
    })
  })

  it('records fresh identifier-bound provider truth after Review source content erasure', async () => {
    const { review } = await seedReviewAndReply({})
    await getDb().transaction(async (tx) => {
      expect(
        await eraseReviewSourceContent(tx, {
          reviewId: review.id,
          organizationId: review.organizationId,
          propertyId: review.propertyId,
          sourceEpoch: review.sourceEpoch,
          expectedSourceRevision: review.sourceRevision,
          state: 'source_expired',
        }),
      ).toBe(true)
    })

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observationInput(review, {
          observationKey: sha256Hex('provider-truth-after-content-erasure'),
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'confirmed_on_google',
      matchedReplyId: REPLY_A,
    })

    const persisted = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(persisted).toMatchObject({
      status: 'published',
      publicationState: 'published',
    })
  })

  it('records different live text as external and prevents retroactive confirmation', async () => {
    const { review } = await seedReviewAndReply({})
    const store = createGoogleReplyObservationStore(getDb())
    const externalInput = observationInput(review, {
      observedText: 'A different live reply',
    })
    const result = await store.record(externalInput)

    expect(result).toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })
    await expect(store.record(externalInput)).resolves.toMatchObject({ duplicate: true })
    const persisted = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(persisted).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observationInput(review, {
          observationKey: sha256Hex('expected-text-after-external-reply'),
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })
    const attempt = await pool.query(
      `SELECT outcome, confirmed_observation_revision
       FROM reply_publication_attempts WHERE reply_id = $1`,
      [REPLY_A],
    )
    expect(attempt.rows[0]).toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    const cancellations = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'
         AND payload->>'cause' = 'provider_truth'`,
      [ORG],
    )
    expect(cancellations.rows).toHaveLength(1)
  })

  it('supersedes a newer attempt when the existing external-live head is unchanged', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const observationStore = createGoogleReplyObservationStore(getDb())
    await expect(
      observationStore.record(
        observationInput(review, {
          observationKey: sha256Hex('external-head-before-new-attempt'),
          observedText: 'Externally managed reply',
        }),
      ),
    ).resolves.toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
    })

    const cancelled = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(cancelled).toMatchObject({ status: 'draft', publicationState: 'cancelled' })

    const commandStore = createTestReplyCommandStore()
    const authorized = await commandStore.markPublicationAuthorized(
      cancelled!,
      { status: 'approved', approvedBy: USER, approvedAt: NOW },
      {
        lifecycleEvent: null,
        publicationIntent: reviewReplyPublicationRequested({
          replyId: REPLY_A,
          reviewId: REVIEW_A,
          propertyId: PROP_A,
          organizationId: ORG,
          userId: USER,
          publicationCycle: 2,
          sourceEpoch: review.sourceEpoch,
          materialReviewRevision: review.sourceRevision,
          baseObservationRevision: 1,
          occurredAt: NOW,
        }),
      },
      NOW,
    )
    expect(authorized).not.toBeNull()
    const claimed = await commandStore.markPublicationSending(
      authorized!,
      {
        providerOperationKey: `publish:${REPLY_A}:2:1`,
        propertyId: PROP_A,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 1,
      },
      NOW,
    )
    expect(claimed).not.toBeNull()
    const pending = await commandStore.markProviderOutcomePendingObservation(
      claimed!,
      { providerCorrelationId: 'new-attempt', providerRespondedAt: NOW },
      NOW,
    )
    expect(pending).not.toBeNull()

    const unchangedInput = observationInput(review, {
      observationKey: sha256Hex('unchanged-external-head-after-new-attempt'),
      observedText: 'Externally managed reply',
    })
    await expect(observationStore.record(unchangedInput)).resolves.toMatchObject({
      change: 'unchanged',
      resolution: 'external_current_live',
      matchedReplyId: null,
    })
    await expect(observationStore.record(unchangedInput)).resolves.toMatchObject({
      duplicate: true,
    })
    await expect(
      createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG),
    ).resolves.toMatchObject({ status: 'draft', publicationState: 'cancelled' })
    const attempt = await pool.query(
      `SELECT outcome, confirmed_observation_revision
       FROM reply_publication_attempts
       WHERE reply_id = $1 AND publication_cycle = 2`,
      [REPLY_A],
    )
    expect(attempt.rows[0]).toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    const observedFact = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.observed'
         AND payload->>'change' = 'unchanged'`,
      [ORG],
    )
    expect(observedFact.rows).toHaveLength(1)
    expect(observedFact.rows[0].payload).toMatchObject({
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    })
    const cancellations = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'
         AND payload->>'cause' = 'provider_truth'`,
      [ORG],
    )
    // One exact cancellation for the zero-attempt authorization and one for
    // the later in-flight attempt; replay cannot duplicate either fact.
    expect(cancellations.rows).toHaveLength(2)
  })

  it('permits a sending re-claim only after a newer targeted absence observation', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    expect(reply.publicationState).toBe('sending')
    await createGoogleReplyObservationStore(getDb()).record(
      observationInput(review, {
        observationKey: sha256Hex('targeted-absence-after-attempt'),
        source: 'targeted_reconciliation',
        publicationTarget: {
          replyId: REPLY_A,
          publicationCycle: 1,
          attemptNumber: 1,
        },
        observedText: null,
      }),
    )

    const reclaimed = await createTestReplyCommandStore().markPublicationSending(
      reply,
      {
        providerOperationKey: `publish:${REPLY_A}:1:2`,
        propertyId: PROP_A,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
      },
      new Date(NOW.getTime() + 1_000),
    )

    expect(reclaimed?.publicationAttempts).toBe(2)
    const attempts = await pool.query(
      `SELECT attempt_number, outcome FROM reply_publication_attempts
       WHERE reply_id = $1 ORDER BY attempt_number`,
      [REPLY_A],
    )
    expect(attempts.rows).toMatchObject([
      { attempt_number: 1, outcome: 'ambiguous' },
      { attempt_number: 2, outcome: 'sending' },
    ])
  })

  it('settles a pre-RPL uncertain send with live truth as external without inventing confirmation provenance', async () => {
    const { review } = await seedReviewAndReply({})
    await pool.query('DELETE FROM reply_publication_attempts WHERE reply_id = $1', [
      REPLY_A,
    ])
    await withPublicationAuthorizationFixtureMutation(() =>
      pool.query('DELETE FROM reply_publication_authorizations WHERE reply_id = $1', [
        REPLY_A,
      ]),
    )
    await pool.query(
      `UPDATE replies
       SET status = 'publish_failed', publication_state = 'ambiguous',
           publication_last_error_class = 'ambiguous', reconcile_due_at = $2
       WHERE id = $1`,
      [REPLY_A, NOW],
    )

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observationInput(review, {
          observationKey: sha256Hex('legacy-uncertain-targeted-live'),
          source: 'targeted_reconciliation',
          publicationTarget: {
            replyId: REPLY_A,
            publicationCycle: 1,
            attemptNumber: 1,
          },
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })

    await expect(
      createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG),
    ).resolves.toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      publicationLastErrorClass: null,
      reconcileDueAt: null,
    })
    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reply_publication_attempts WHERE reply_id = $1) attempts,
         (SELECT count(*)::int FROM reply_publication_authorizations WHERE reply_id = $1) authorizations,
         (SELECT count(*)::int FROM outbox_events
            WHERE organization_id = $2
              AND event_type = 'review.reply.published') published_facts`,
      [REPLY_A, ORG],
    )
    expect(evidence.rows[0]).toEqual({
      attempts: 0,
      authorizations: 0,
      published_facts: 0,
    })
    const cancellation = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'`,
      [ORG],
    )
    expect(cancellation.rows).toHaveLength(1)
    expect(cancellation.rows[0].payload).toMatchObject({ cause: 'provider_truth' })
  })

  it('settles a pre-RPL uncertain send after targeted absence without inventing provenance', async () => {
    const { review } = await seedReviewAndReply({})
    await pool.query('DELETE FROM reply_publication_attempts WHERE reply_id = $1', [
      REPLY_A,
    ])
    await withPublicationAuthorizationFixtureMutation(() =>
      pool.query('DELETE FROM reply_publication_authorizations WHERE reply_id = $1', [
        REPLY_A,
      ]),
    )
    await pool.query(
      `UPDATE replies
       SET status = 'publish_failed', publication_state = 'ambiguous',
           publication_last_error_class = 'ambiguous', reconcile_due_at = $2
       WHERE id = $1`,
      [REPLY_A, NOW],
    )

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observationInput(review, {
          observationKey: sha256Hex('legacy-uncertain-targeted-absence'),
          source: 'targeted_reconciliation',
          publicationTarget: {
            replyId: REPLY_A,
            publicationCycle: 1,
            attemptNumber: 1,
          },
          observedText: null,
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'unchanged',
      matchedReplyId: null,
    })

    await expect(
      createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG),
    ).resolves.toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      publicationLastErrorClass: null,
      reconcileDueAt: null,
    })
    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reply_publication_attempts WHERE reply_id = $1) attempts,
         (SELECT count(*)::int FROM reply_publication_authorizations WHERE reply_id = $1) authorizations`,
      [REPLY_A],
    )
    expect(counts.rows[0]).toEqual({ attempts: 0, authorizations: 0 })
    const cancellation = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'`,
      [ORG],
    )
    expect(cancellation.rows).toHaveLength(1)
    expect(cancellation.rows[0].payload).toMatchObject({ cause: 'provider_truth' })
  })

  it('refuses a targeted read captured for an older attempt after a newer attempt is current', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    const store = createGoogleReplyObservationStore(getDb())
    const staleTarget = {
      replyId: REPLY_A,
      publicationCycle: 1,
      attemptNumber: 1,
    }
    await store.record(
      observationInput(review, {
        readGeneration: await store.allocateReadGeneration(),
        observationKey: sha256Hex('attempt-one-absence'),
        source: 'targeted_reconciliation',
        publicationTarget: staleTarget,
        observedText: null,
      }),
    )
    const reclaimed = await createTestReplyCommandStore().markPublicationSending(
      reply,
      {
        providerOperationKey: `publish:${REPLY_A}:1:2:target-race`,
        propertyId: PROP_A,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
      },
      new Date(NOW.getTime() + 1_000),
    )
    expect(reclaimed?.publicationAttempts).toBe(2)

    await expect(
      store.record(
        observationInput(review, {
          readGeneration: await store.allocateReadGeneration(),
          observationKey: sha256Hex('late-attempt-one-live-read'),
          source: 'targeted_reconciliation',
          publicationTarget: staleTarget,
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    const current = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(current).toMatchObject({
      status: 'approved',
      publicationState: 'sending',
      publicationAttempts: 2,
    })
  })

  it('does not let an older acquired provider response replace a newer observation head', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const olderGeneration = await store.allocateReadGeneration()
    const newerGeneration = await store.allocateReadGeneration()
    const older = observationInput(review, {
      readGeneration: olderGeneration,
      observationKey: sha256Hex('older-provider-read'),
      observedText: 'Older provider reply',
    })
    const newer = observationInput(review, {
      readGeneration: newerGeneration,
      observationKey: sha256Hex('newer-provider-read'),
      observedText: 'Newer provider reply',
    })

    await expect(store.record(newer)).resolves.toMatchObject({ duplicate: false })
    await expect(store.record(older)).rejects.toMatchObject({
      code: 'invalid_transition',
    })
    const rows = await pool.query(
      `SELECT o.normalized_text, o.read_generation::text AS read_generation
       FROM google_reply_observation_heads h
       JOIN google_reply_observations o ON o.id = h.observation_id
       WHERE h.review_id = $1`,
      [REVIEW_A],
    )
    expect(rows.rows[0]).toEqual({
      normalized_text: 'Newer provider reply',
      read_generation: String(newerGeneration),
    })
  })

  it('refuses a first provider claim after the Review material revision advances', async () => {
    const { review, reply } = await seedReviewAndReply({ claim: false })
    const later = new Date(NOW.getTime() + 1_000)
    const advanced = await createReviewRepository(getDb(), () => new Date()).upsert(
      {
        ...makeReview(REVIEW_A, `external-${REVIEW_A}`),
        text: 'A materially changed review after manager authorization',
        sourceUpdatedAt: later,
        lastFetchedAt: later,
        contentExpiresAt: new Date(EXPIRES.getTime() + 1_000),
      },
      later,
      sha256Hex('review-material-advanced-after-authorization'),
    )
    expect(advanced.sourceRevision).toBe(review.sourceRevision + 1)

    const claimed = await createTestReplyCommandStore().markPublicationSending(
      reply,
      {
        providerOperationKey: `publish:${REPLY_A}:stale-material`,
        propertyId: PROP_A,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
      },
      later,
    )

    expect(claimed).toBeNull()
  })

  it('atomically cancels and supersedes publication work when the Review source advances', async () => {
    const { review } = await seedReviewAndReply({})
    const later = new Date(NOW.getTime() + 2_000)
    const advanced = await createAtomicReviewCommandStore(
      getDb(),
      () => new Date(),
    ).upsertAndRecord(
      {
        ...makeReview(REVIEW_A, `external-${REVIEW_A}`),
        text: 'A later material Review revision',
        sourceUpdatedAt: later,
        lastFetchedAt: later,
        contentExpiresAt: new Date(EXPIRES.getTime() + 2_000),
      },
      (persisted) =>
        reviewUpdated({
          reviewId: persisted.id,
          propertyId: persisted.propertyId,
          organizationId: persisted.organizationId,
          platform: persisted.platform,
          sourceEpoch: persisted.sourceEpoch,
          sourceRevision: persisted.sourceRevision,
          analysisSequence: persisted.analysisSequence,
          occurredAt: later,
        }),
      later,
      sha256Hex('source-change-supersedes-publication'),
    )
    expect(advanced.sourceRevision).toBe(review.sourceRevision + 1)

    const reply = await createReplyRepository(getDb(), () => new Date()).findById(
      REPLY_A,
      ORG,
    )
    expect(reply).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      reconcileDueAt: null,
    })
    const attempts = await pool.query(
      `SELECT outcome, confirmed_observation_revision
       FROM reply_publication_attempts WHERE reply_id = $1`,
      [REPLY_A],
    )
    expect(attempts.rows[0]).toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    const facts = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'`,
      [ORG],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].payload).toMatchObject({ cause: 'source_changed' })
  })

  it('atomically cancels a zero-attempt authorization when an absent Google reply head advances', async () => {
    const { review, reply } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const absentInput = observationInput(review, {
      observationKey: sha256Hex('absent-head-advanced-after-authorization'),
      observedText: null,
      providerUpdatedAt: null,
    })
    await expect(store.record(absentInput)).resolves.toMatchObject({
      observationRevision: 1,
      resolution: 'unchanged',
      matchedReplyId: null,
    })
    await expect(store.record(absentInput)).resolves.toMatchObject({ duplicate: true })

    await expect(
      createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG),
    ).resolves.toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      publicationAttempts: 0,
    })
    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM reply_publication_attempts WHERE reply_id = $1) attempts,
         (SELECT count(*)::int FROM reply_publication_authorizations WHERE reply_id = $1) authorizations,
         (SELECT count(*)::int FROM outbox_events
            WHERE organization_id = $2
              AND event_type = 'review.reply.publication_cancelled'
              AND payload->>'cause' = 'provider_truth') cancellations`,
      [REPLY_A, ORG],
    )
    expect(evidence.rows[0]).toEqual({
      attempts: 0,
      authorizations: 1,
      cancellations: 1,
    })

    // A delayed durable intent still cannot reach the provider; cancellation
    // is already durable instead of leaving an invisible authorized row.
    const claimed = await createTestReplyCommandStore().markPublicationSending(
      reply,
      {
        providerOperationKey: `publish:${REPLY_A}:stale-head`,
        propertyId: PROP_A,
        sourceEpoch: review.sourceEpoch,
        materialReviewRevision: review.sourceRevision,
        baseObservationRevision: 0,
      },
      new Date(NOW.getTime() + 1_000),
    )

    expect(claimed).toBeNull()
  })

  it('supersedes the current attempt on cancellation so later provider truth remains recordable', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    const commandStore = createTestReplyCommandStore()
    await expect(
      commandStore.cancelPublications([
        {
          reply,
          event: reviewReplyPublicationCancelled({
            replyId: reply.id,
            reviewId: reply.reviewId,
            propertyId: review.propertyId,
            organizationId: reply.organizationId,
            cause: 'disconnect',
            occurredAt: NOW,
          }),
          now: NOW,
        },
      ]),
    ).resolves.toBe(1)

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observationInput(review, {
          observationKey: sha256Hex('provider-truth-after-cancellation'),
          source: 'targeted_reconciliation',
          publicationTarget: {
            replyId: REPLY_A,
            publicationCycle: 1,
            attemptNumber: 1,
          },
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })

    const attempt = await pool.query(
      `SELECT outcome, confirmed_observation_revision
       FROM reply_publication_attempts WHERE reply_id = $1`,
      [REPLY_A],
    )
    expect(attempt.rows[0]).toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    await expect(
      createReplyRepository(getDb(), () => new Date()).findById(REPLY_A, ORG),
    ).resolves.toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
  })
})

describe.sequential('RPL evidence-chain relational fences (real PostgreSQL)', () => {
  async function expectConstraint(
    query: string,
    values: readonly unknown[],
    constraint: string,
  ): Promise<void> {
    await expect(pool.query(query, values as unknown[])).rejects.toMatchObject({
      constraint,
    })
  }

  const attemptInsert = `
    INSERT INTO reply_publication_attempts
      (organization_id, property_id, review_id, reply_id, publication_cycle,
       attempt_number, provider_operation_key, source_epoch,
       material_review_revision, reply_state_revision,
       normalization_version, expected_reply_digest, outcome)
    VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, 1,
            'google-reply-v1', $8, 'sending')`

  const observationInsert = `
    INSERT INTO google_reply_observations
      (organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance, normalized_text,
       normalization_version, normalized_digest, matched_reply_id,
       matched_publication_cycle, matched_attempt_number, observed_at,
       content_expires_at)
    VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 1, 'live', 'added', $8,
            'targeted_reconciliation', $9, 'reply', 'google-reply-v1', $10,
            $11, $12, $13, $14, $15)`

  it('rejects an attempt cross-wired to another Review tenant tuple', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      attemptInsert,
      [ORG, PROP_B, REVIEW_A, REPLY_A, 'bad-review-scope', 0, 1, 'a'.repeat(64)],
      'reply_publication_attempts_review_tenant_fk',
    )
  })

  it('rejects an attempt cross-wired to a Reply owned by another Review', async () => {
    await seedReviewAndReply({ claim: false })
    await seedReviewAndReply({
      reviewId: REVIEW_B,
      replyId: REPLY_B,
      externalId: 'external-review-b',
      claim: false,
    })
    await expectConstraint(
      attemptInsert,
      [ORG, PROP_A, REVIEW_A, REPLY_B, 'bad-reply-binding', 0, 1, 'a'.repeat(64)],
      'reply_publication_attempts_reply_binding_fk',
    )
  })

  it('rejects an attempt cross-wired to a nonexistent material revision', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      attemptInsert,
      [ORG, PROP_A, REVIEW_A, REPLY_A, 'bad-material', 0, 2, 'a'.repeat(64)],
      'reply_publication_attempts_material_revision_fk',
    )
  })

  it('rejects an observation cross-wired to another property', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      observationInsert,
      [
        ORG,
        PROP_B,
        REVIEW_A,
        '1'.repeat(64),
        '2'.repeat(64),
        0,
        1,
        'external_current_live',
        'external_or_unknown',
        '3'.repeat(64),
        null,
        null,
        null,
        NOW,
        EXPIRES,
      ],
      'google_reply_observations_review_tenant_fk',
    )
  })

  it('rejects an observation cross-wired to a nonexistent material revision', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      observationInsert,
      [
        ORG,
        PROP_A,
        REVIEW_A,
        '1'.repeat(64),
        '2'.repeat(64),
        0,
        2,
        'external_current_live',
        'external_or_unknown',
        '3'.repeat(64),
        null,
        null,
        null,
        NOW,
        EXPIRES,
      ],
      'google_reply_observations_material_revision_fk',
    )
  })

  it('rejects a claimed match that does not identify one exact attempt', async () => {
    await seedReviewAndReply({})
    await expectConstraint(
      observationInsert,
      [
        ORG,
        PROP_A,
        REVIEW_A,
        '1'.repeat(64),
        '2'.repeat(64),
        0,
        1,
        'confirmed_on_google',
        'repkey_confirmed',
        '3'.repeat(64),
        REPLY_A,
        1,
        99,
        NOW,
        EXPIRES,
      ],
      'google_reply_observations_matched_attempt_fk',
    )
  })

  it('requires matched Reply, cycle, and attempt fields all together', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      observationInsert,
      [
        ORG,
        PROP_A,
        REVIEW_A,
        '1'.repeat(64),
        '2'.repeat(64),
        0,
        1,
        'external_current_live',
        'external_or_unknown',
        '3'.repeat(64),
        REPLY_A,
        null,
        null,
        NOW,
        EXPIRES,
      ],
      'google_reply_observations_match_valid',
    )
  })

  it('rejects a relationally impossible live observation resolution', async () => {
    await seedReviewAndReply({ claim: false })
    await expectConstraint(
      observationInsert.replace("'live', 'added'", "'live', 'deleted'"),
      [
        ORG,
        PROP_A,
        REVIEW_A,
        '1'.repeat(64),
        '2'.repeat(64),
        0,
        1,
        'external_current_live',
        'external_or_unknown',
        '3'.repeat(64),
        null,
        null,
        null,
        NOW,
        EXPIRES,
      ],
      'google_reply_observations_semantics_valid',
    )
  })

  it('binds every head field to the same exact observation row', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    await createGoogleReplyObservationStore(getDb()).record(observationInput(review))
    await expectConstraint(
      `UPDATE google_reply_observation_heads
       SET provenance = 'none' WHERE review_id = $1`,
      [REVIEW_A],
      'google_reply_observation_heads_exact_observation_fk',
    )
  })

  it('binds attempt confirmation to an observation from that exact Review', async () => {
    await seedReviewAndReply({})
    const { review: otherReview } = await seedReviewAndReply({
      reviewId: REVIEW_B,
      replyId: REPLY_B,
      externalId: 'external-review-b',
      claim: false,
    })
    await createGoogleReplyObservationStore(getDb()).record(
      observationInput(otherReview, {
        observationKey: sha256Hex('other-review-observation'),
      }),
    )
    await expectConstraint(
      `UPDATE reply_publication_attempts
       SET outcome = 'confirmed', confirmed_observation_revision = 1
       WHERE reply_id = $1`,
      [REPLY_A],
      'reply_publication_attempts_exact_confirmation_fk',
    )
  })

  it('rejects confirmation with an observation matched to another attempt on the same Review', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    const digest = compareObservedGoogleReply(reply.text, reply.text).desiredDigest
    await pool.query(
      `INSERT INTO reply_publication_attempts
        (organization_id, property_id, review_id, reply_id, publication_cycle,
         attempt_number, provider_operation_key, source_epoch,
         material_review_revision, reply_state_revision,
         normalization_version, expected_reply_digest, outcome)
       VALUES ($1, $2, $3, $4, 1, 2, $5, $6, $7, $8,
               'google-reply-v1', $9, 'sending')`,
      [
        ORG,
        PROP_A,
        REVIEW_A,
        REPLY_A,
        'same-review-attempt-2',
        0,
        1,
        reply.stateRevision,
        digest,
      ],
    )
    await pool.query(observationInsert, [
      ORG,
      PROP_A,
      REVIEW_A,
      '4'.repeat(64),
      '5'.repeat(64),
      review.sourceEpoch,
      review.sourceRevision,
      'confirmed_on_google',
      'repkey_confirmed',
      digest,
      REPLY_A,
      1,
      2,
      NOW,
      EXPIRES,
    ])

    await expectConstraint(
      `UPDATE reply_publication_attempts
       SET outcome = 'confirmed', confirmed_observation_revision = 1
       WHERE reply_id = $1 AND attempt_number = 1`,
      [REPLY_A],
      'reply_publication_attempts_exact_confirmation_fk',
    )
  })
})
