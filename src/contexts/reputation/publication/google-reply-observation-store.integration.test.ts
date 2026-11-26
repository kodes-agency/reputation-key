import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { hasCurrentReplyForAi } from '../reviews/unanswered-review.server'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createGoogleReplyObservationStore } from './google-reply-observation-store.server'
import { eraseReviewSourceContent } from '#/contexts/reputation/content/store.server'
import {
  ORG,
  PROP_A,
  PROP_B,
  REPLY_A,
  REVIEW_A,
  advanceReviewMaterially,
  attemptOutcome,
  installObservationFixture,
  makeReview,
  NOW,
  observationInput,
  observe,
  pool,
  seedReviewAndReply,
  storedReply,
  targeted,
} from './google-reply-observation.test-fixtures'

installObservationFixture()

describe.sequential('Google reply observation authority (real PostgreSQL)', () => {
  it('keeps provider acceptance pending until exact observed text confirms it', async () => {
    const { review, reply } = await seedReviewAndReply({})
    expect(reply.publicationState).toBe('pending_observation')

    const store = createGoogleReplyObservationStore(getDb())
    const result = await store.record(observationInput(review))

    expect(result).toMatchObject({
      duplicate: false,
      change: 'added',
      resolution: 'confirmed_on_google',
      matchedReplyId: REPLY_A,
      matchedPublicationCycle: 1,
    })
    await expect(store.findCurrentByReviewId(REVIEW_A, ORG)).resolves.toMatchObject({
      reviewId: REVIEW_A,
      organizationId: ORG,
      state: 'live',
      provenance: 'repkey_confirmed',
      normalizedText: 'Thank you for your review!',
      matchedReplyId: REPLY_A,
      observationRevision: 1,
      contentState: 'active',
    })
    expect(await storedReply()).toMatchObject({
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
      observe(review, 'google-reply-observation-confirmation-scan'),
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
    const input = observe(review, 'replay-before-material-advance')
    expect(await store.record(input)).toMatchObject({ duplicate: false })

    const advanced = await advanceReviewMaterially(
      'A materially changed review',
      'review-material-observation-2',
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
        await eraseReviewSourceContent(
          tx,
          {
            reviewId: review.id,
            organizationId: review.organizationId,
            propertyId: review.propertyId,
            sourceEpoch: review.sourceEpoch,
            expectedSourceRevision: review.sourceRevision,
            state: 'source_expired',
          },
          replyScopeEffects,
        ),
      ).toBe(true)
    })

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observe(review, 'provider-truth-after-content-erasure'),
      ),
    ).resolves.toMatchObject({
      resolution: 'confirmed_on_google',
      matchedReplyId: REPLY_A,
    })

    expect(await storedReply()).toMatchObject({
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
    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observe(review, 'expected-text-after-external-reply'),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })
    expect(await attemptOutcome()).toEqual({
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

  it('lets an older sync read pass without replacing a newer observation head', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const olderGeneration = await store.allocateReadGeneration()
    const newerGeneration = await store.allocateReadGeneration()
    const older = observe(review, 'older-provider-read', {
      readGeneration: olderGeneration,
      observedText: 'Older provider reply',
    })
    const newer = observe(review, 'newer-provider-read', {
      readGeneration: newerGeneration,
      observedText: 'Newer provider reply',
    })

    const stored = await store.record(newer)
    expect(stored).toMatchObject({ duplicate: false })
    await expect(store.record(older)).resolves.toEqual({
      observationRevision: stored.observationRevision,
      change: 'unchanged',
      resolution: 'unchanged',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: true,
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
    const written = await pool.query(
      `SELECT count(*)::int AS count FROM google_reply_observations WHERE review_id = $1`,
      [REVIEW_A],
    )
    expect(written.rows[0]).toEqual({ count: 1 })
  })

  it('still refuses an older targeted read, because the reconciler maps its outcome from that refusal', async () => {
    const { review } = await seedReviewAndReply({ providerPending: false })
    const store = createGoogleReplyObservationStore(getDb())
    const olderGeneration = await store.allocateReadGeneration()
    const newerGeneration = await store.allocateReadGeneration()
    await store.record(
      observe(review, 'newer-sync-read', {
        readGeneration: newerGeneration,
        observedText: 'Newer provider reply',
      }),
    )

    await expect(
      store.record(
        observe(review, 'older-targeted-read', {
          readGeneration: olderGeneration,
          ...targeted(),
          observedText: 'Older provider reply',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('records nothing for a read that only restates the head', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    const scope = {
      organizationId: ORG,
      propertyId: review.propertyId,
      reviewId: review.id,
    }
    const absent = { observedText: null, providerUpdatedAt: null }
    await store.record(observe(review, 'restate-first', absent))
    const head = await store.findCurrentHead(scope)

    await store.record(observe(review, 'restate-second', absent))

    await expect(store.findCurrentHead(scope)).resolves.toEqual(head)
  })
})

it('background eligibility follows local and externally observed reply truth', async () => {
  const db = getDb()
  const repository = createReviewRepository(db, () => NOW, undefined, replyScopeEffects)
  const review = await repository.upsert(makeReview(REVIEW_A, 'background-eligibility'))
  const scope = { organizationId: ORG, propertyId: PROP_A, reviewId: REVIEW_A }
  expect(await hasCurrentReplyForAi(db, scope)).toBe(false)
  await createGoogleReplyObservationStore(db).record(
    observationInput(review, { observedText: 'A reply written directly on Google.' }),
  )
  expect(await hasCurrentReplyForAi(db, scope)).toBe(true)
  await createGoogleReplyObservationStore(db).record(
    observe(review, 'background-absent', { observedText: null }),
  )
  expect(await hasCurrentReplyForAi(db, scope)).toBe(false)
  await pool.query(
    "INSERT INTO replies (id, review_id, organization_id, text, status, source) VALUES ($1, $2, $3, 'A local draft.', 'draft', 'internal')",
    [REPLY_A, REVIEW_A, ORG],
  )
  expect(await hasCurrentReplyForAi(db, scope)).toBe(true)
  expect(
    await hasCurrentReplyForAi(db, {
      ...scope,
      organizationId: organizationId('other-tenant'),
    }),
  ).toBe(true)
})
