import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { sha256Hex } from '#/shared/domain/sha256'
import {
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublicationRequested,
  reviewReplySubmitted,
  reviewUpdated,
} from '../domain/review-events'
import { createAtomicReviewCommandStore } from '../reviews/review-command-store.server'
import { createTestReplyCommandStore } from '../replies/reply-publication.test-fixtures'
import { createGoogleReplyObservationStore } from './google-reply-observation-store.server'
import {
  EXPIRES,
  NOW,
  ORG,
  PROP_A,
  REPLY_A,
  REVIEW_A,
  USER,
  advanceReviewMaterially,
  attemptOutcome,
  cancellationFacts,
  installObservationFixture,
  makeReview,
  observe,
  pool,
  seedLegacyUncertainSend,
  seedReviewAndReply,
  storedReply,
  targeted,
} from './google-reply-observation.test-fixtures'

installObservationFixture()

describe.sequential('Google reply observation authority (real PostgreSQL)', () => {
  // D6: Google may echo the reply RepKey sent with its blank lines or trailing
  // spaces reformatted. Exact google-reply-v1 digest matching stays the only way
  // to confirm, but such an echo is not another author's reply, so it must not
  // cancel the in-flight publication either. `diverged` is the one resolution
  // the observation check constraints allow for live text that neither confirms
  // nor closes the handling target.
  const MULTI_LINE_REPLY = 'Thank you for your review!\n\nWe hope to welcome you back.'
  const REFORMATTED_REPLY =
    'Thank you for your review!  \n\n\n\nWe hope to welcome you back. '

  it('keeps a pending attempt in flight when a snapshot shows it with only whitespace reformatted', async () => {
    const { review } = await seedReviewAndReply({ text: MULTI_LINE_REPLY })
    const store = createGoogleReplyObservationStore(getDb())

    await expect(
      store.record(
        observe(review, 'snapshot-whitespace-reformatted', {
          observedText: REFORMATTED_REPLY,
        }),
      ),
    ).resolves.toMatchObject({
      duplicate: false,
      change: 'added',
      resolution: 'diverged',
      matchedReplyId: null,
    })
    // A later snapshot restating the same reformatted echo says nothing new.
    await expect(
      store.record(
        observe(review, 'snapshot-whitespace-reformatted-reread', {
          observedText: REFORMATTED_REPLY,
        }),
      ),
    ).resolves.toMatchObject({ duplicate: true, resolution: 'diverged' })

    expect(await storedReply()).toMatchObject({
      status: 'approved',
      publicationState: 'pending_observation',
    })
    await expect(attemptOutcome()).resolves.toEqual({
      outcome: 'provider_outcome_pending',
      confirmed_observation_revision: null,
    })
    expect(await cancellationFacts()).toBe(0)

    // The fence stayed open: the exact text still confirms.
    await expect(
      store.record(
        observe(review, 'snapshot-exact-after-reformatted', {
          observedText: MULTI_LINE_REPLY,
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'confirmed_on_google',
      matchedReplyId: REPLY_A,
    })
  })

  it('keeps a sending attempt in flight when a targeted read shows only whitespace reformatted, and still supersedes on a different reply', async () => {
    const { review } = await seedReviewAndReply({
      text: MULTI_LINE_REPLY,
      providerPending: false,
    })
    const store = createGoogleReplyObservationStore(getDb())

    await expect(
      store.record(
        observe(review, 'targeted-whitespace-reformatted', {
          ...targeted(),
          observedText: REFORMATTED_REPLY,
        }),
      ),
    ).resolves.toMatchObject({ resolution: 'diverged', matchedReplyId: null })

    expect(await storedReply()).toMatchObject({
      status: 'approved',
      publicationState: 'sending',
    })
    await expect(attemptOutcome()).resolves.toEqual({
      outcome: 'sending',
      confirmed_observation_revision: null,
    })
    expect(await cancellationFacts()).toBe(0)

    await expect(
      store.record(
        observe(review, 'targeted-different-after-reformatted', {
          ...targeted(),
          observedText: 'Thanks, we hope to welcome you back.',
        }),
      ),
    ).resolves.toMatchObject({ change: 'edited', resolution: 'external_current_live' })
    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
    await expect(attemptOutcome()).resolves.toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    expect(await cancellationFacts()).toBe(1)
  })

  // D5: "Check Google again" on terminal ambiguity must be able to report a
  // different reply on Google. The exact echo already confirmed from terminal
  // ambiguity; a different one threw `invalid_transition`, failing the check
  // with a 400 and every snapshot import of that Review.
  it.each(['targeted_reconciliation', 'provider_snapshot'] as const)(
    'supersedes terminal ambiguity when a %s read shows a different reply',
    async (source) => {
      const { review, reply: sending } = await seedReviewAndReply({
        providerPending: false,
      })
      const commandStore = createTestReplyCommandStore()
      const ambiguous = await commandStore.markPublicationAmbiguous(sending, null, NOW)
      const terminal = await commandStore.markPublicationTerminal(
        ambiguous!,
        'ambiguous',
        null,
        NOW,
      )
      expect(terminal).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'ambiguous',
      })

      await expect(
        createGoogleReplyObservationStore(getDb()).record(
          observe(review, `terminal-ambiguity-different-${source}`, {
            ...(source === 'targeted_reconciliation' ? targeted() : { source }),
            observedText: 'A reply someone posted directly on Google',
          }),
        ),
      ).resolves.toMatchObject({ resolution: 'external_current_live' })

      expect(await storedReply()).toMatchObject({
        status: 'draft',
        publicationState: 'cancelled',
        reconcileDueAt: null,
      })
      await expect(attemptOutcome()).resolves.toEqual({
        outcome: 'superseded',
        confirmed_observation_revision: null,
      })
      expect(await cancellationFacts()).toBe(1)
    },
  )

  it('supersedes a newer attempt when the existing external-live head is unchanged', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const observationStore = createGoogleReplyObservationStore(getDb())
    await expect(
      observationStore.record(
        observe(review, 'external-head-before-new-attempt', {
          observedText: 'Externally managed reply',
        }),
      ),
    ).resolves.toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
    })

    const cancelled = await storedReply()
    expect(cancelled).toMatchObject({ status: 'draft', publicationState: 'cancelled' })

    // A cancelled reply is a draft again: it is submitted and approved anew
    // before its next cycle is authorized.
    const commandStore = createTestReplyCommandStore()
    const resubmitted = await commandStore.submitReply(
      cancelled!,
      { status: 'pending_approval', submittedAt: NOW, submittedBy: USER },
      reviewReplySubmitted({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG,
        userId: USER,
        occurredAt: NOW,
      }),
      NOW,
    )
    const authorized = await commandStore.markPublicationAuthorized(
      resubmitted!,
      { status: 'approved', approvedBy: USER, approvedAt: NOW },
      {
        lifecycleEvent: reviewReplyApproved({
          replyId: REPLY_A,
          reviewId: REVIEW_A,
          propertyId: PROP_A,
          organizationId: ORG,
          userId: USER,
          authorId: USER,
          occurredAt: NOW,
        }),
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

    const unchangedInput = observe(review, 'unchanged-external-head-after-new-attempt', {
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
    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
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

  it('refuses a second claim even after a targeted absence observation', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    expect(reply.publicationState).toBe('sending')
    await createGoogleReplyObservationStore(getDb()).record(
      observe(review, 'targeted-absence-after-attempt', {
        ...targeted(),
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

    expect(reclaimed).toBeNull()
    const attempts = await pool.query(
      `SELECT attempt_number, outcome FROM reply_publication_attempts
       WHERE reply_id = $1 ORDER BY attempt_number`,
      [REPLY_A],
    )
    expect(attempts.rows).toEqual([{ attempt_number: 1, outcome: 'sending' }])
  })

  it('settles a pre-RPL uncertain send with live truth as external without inventing confirmation provenance', async () => {
    const { review } = await seedLegacyUncertainSend()

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observe(review, 'legacy-uncertain-targeted-live', targeted()),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })

    expect(await storedReply()).toMatchObject({
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
    const { review } = await seedLegacyUncertainSend()

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observe(review, 'legacy-uncertain-targeted-absence', {
          ...targeted(),
          observedText: null,
        }),
      ),
    ).resolves.toMatchObject({
      resolution: 'unchanged',
      matchedReplyId: null,
    })

    expect(await storedReply()).toMatchObject({
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

  it('refuses a targeted read captured for a different attempt', async () => {
    const { review } = await seedReviewAndReply({ providerPending: false })
    const store = createGoogleReplyObservationStore(getDb())

    await expect(
      store.record(
        observe(review, 'wrong-attempt-live-read', {
          readGeneration: await store.allocateReadGeneration(),
          ...targeted(2),
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
    expect(await storedReply()).toMatchObject({
      status: 'approved',
      publicationState: 'sending',
      publicationAttempts: 1,
    })
  })

  it('refuses a first provider claim after the Review material revision advances', async () => {
    const { review, reply } = await seedReviewAndReply({ claim: false })
    const later = new Date(NOW.getTime() + 1_000)
    const advanced = await advanceReviewMaterially(
      'A materially changed review after manager authorization',
      'review-material-advanced-after-authorization',
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
      undefined,
      undefined,
      replyScopeEffects,
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

    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      reconcileDueAt: null,
    })
    expect(await attemptOutcome()).toEqual({
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
    const absentInput = observe(review, 'absent-head-advanced-after-authorization', {
      observedText: null,
      providerUpdatedAt: null,
    })
    await expect(store.record(absentInput)).resolves.toMatchObject({
      observationRevision: 1,
      resolution: 'unchanged',
      matchedReplyId: null,
    })
    await expect(store.record(absentInput)).resolves.toMatchObject({ duplicate: true })

    expect(await storedReply()).toMatchObject({
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

  // The read the publish worker makes before it claims is recorded as a
  // provider snapshot. A reply typed on Google since the last sync moves the head
  // the manager authorized against.
  it('cancels a zero-attempt authorization as provider truth when a live external reply is recorded', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    const store = createGoogleReplyObservationStore(getDb())
    // The head the manager's approval was authorized against: no reply.
    await store.record(
      observe(review, 'external-reply-first-sync', {
        observedText: null,
        providerUpdatedAt: null,
      }),
    )

    await expect(
      store.record(
        observe(review, 'external-reply-typed-on-google', {
          observedText: 'Thanks for your review! - The Front Desk',
        }),
      ),
    ).resolves.toMatchObject({ resolution: 'external_current_live' })

    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
      publicationAttempts: 0,
    })
    const causes = await pool.query(
      `SELECT payload->>'cause' AS cause FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'review.reply.publication_cancelled'`,
      [ORG],
    )
    expect(causes.rows).toEqual([{ cause: 'provider_truth' }])
  })

  it('leaves a requeued cycle to the claim, which refuses it: the publish job ends it', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    const commandStore = createTestReplyCommandStore()
    const requeued = await commandStore.markPublicationRetryQueued(reply, NOW)
    expect(requeued).toMatchObject({
      publicationState: 'authorized',
      publicationAttempts: 1,
    })
    const store = createGoogleReplyObservationStore(getDb())

    await expect(
      store.record(
        observe(review, 'external-reply-after-requeue', {
          observedText: 'Thanks for your review! - The Front Desk',
        }),
      ),
    ).resolves.toMatchObject({ resolution: 'external_current_live' })

    // The store did not cancel it: it only cancels a cycle that never sent.
    expect(await storedReply()).toMatchObject({
      status: 'approved',
      publicationState: 'authorized',
    })
    // The claim's head fence is what stops it.
    await expect(
      commandStore.markPublicationSending(
        requeued!,
        {
          providerOperationKey: `publish:${REPLY_A}:requeued`,
          propertyId: PROP_A,
          sourceEpoch: review.sourceEpoch,
          materialReviewRevision: review.sourceRevision,
          baseObservationRevision: 0,
        },
        new Date(NOW.getTime() + 1_000),
      ),
    ).resolves.toBeNull()
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
            authorId: reply.createdBy,
            cause: 'disconnect',
            occurredAt: NOW,
          }),
          now: NOW,
        },
      ]),
    ).resolves.toBe(1)

    await expect(
      createGoogleReplyObservationStore(getDb()).record(
        observe(review, 'provider-truth-after-cancellation', targeted()),
      ),
    ).resolves.toMatchObject({
      resolution: 'external_current_live',
      matchedReplyId: null,
    })

    expect(await attemptOutcome()).toEqual({
      outcome: 'superseded',
      confirmed_observation_revision: null,
    })
    expect(await storedReply()).toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
  })
})
