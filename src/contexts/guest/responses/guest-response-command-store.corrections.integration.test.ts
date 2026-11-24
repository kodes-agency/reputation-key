import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { sql } from 'drizzle-orm'
import type { GuestResponse } from '../domain/guest-response'
import {
  NOW,
  ORG,
  RESPONSE,
  arrangeSubmitted,
  buildGuestResponse,
  commitOtherTenantResponse,
  createAtomicGuestResponseCommandStore,
  crossTenantFeedbackRetraction,
  crossTenantRatingRetraction,
  deleteGuestResponseTenants,
  deletedResponse,
  excludeForReview,
  expectOtherTenantResponseUntouched,
  facts,
  feedbackFact,
  feedbackRetraction,
  otherTenantResponse,
  outboxTypes,
  ratingCorrection,
  ratingOnlyResponse,
  ratingRetraction,
  resetGuestResponseState,
  responseRow,
  responseWithFeedbackRow,
  seedGuestResponseTenants,
  submitAndCorrect,
} from './guest-response.test-fixtures'

const db = getDb()
const FEEDBACK_TEXT = 'Please contact the front desk.'
const WITHDRAWN_AT = new Date('2026-08-25T12:45:00.000Z')

beforeAll(async () => {
  await seedGuestResponseTenants()
})

beforeEach(resetGuestResponseState)

afterAll(async () => {
  await deleteGuestResponseTenants()
})

describe.sequential('atomic Guest response submission', () => {
  it('adds private feedback atomically without consuming the rating correction', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [rating] = facts()
    const ratingOnly = ratingOnlyResponse()
    await store.commitSubmitted(ratingOnly, [rating])

    const feedback = feedbackFact()
    const withFeedback: GuestResponse = {
      ...ratingOnly,
      ratingSourceEventId: rating.eventId,
      text: FEEDBACK_TEXT,
      textConsent: true,
      feedbackSubmittedAt: NOW,
      feedbackSubmissionRevision: 1,
      feedbackWithdrawnAt: null,
    }

    await expect(store.commitFeedbackAdded(withFeedback, feedback)).resolves.toBe(
      'applied',
    )
    await expect(store.commitFeedbackAdded(withFeedback, feedback)).resolves.toBe(
      'conflict',
    )

    expect(
      await responseWithFeedbackRow(
        'f.body AS response_text, r.feedback_source_event_id, r.correction_count',
      ),
    ).toEqual([
      {
        response_text: FEEDBACK_TEXT,
        feedback_source_event_id: feedback.eventId,
        correction_count: 0,
      },
    ])
  })

  it('renews the separated recovery binding from a late feedback submission', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [rating] = facts()
    const ratingOnly = ratingOnlyResponse()
    await store.commitSubmitted(ratingOnly, [rating])
    const feedbackAt = new Date('2026-08-26T11:00:00.000Z')
    const renewedUntil = new Date('2026-08-27T11:00:00.000Z')

    await expect(
      store.commitFeedbackAdded(
        {
          ...ratingOnly,
          ratingSourceEventId: rating.eventId,
          text: 'Late private note.',
          textConsent: true,
          feedbackSubmittedAt: feedbackAt,
          feedbackSubmissionRevision: 1,
          sessionExpiresAt: renewedUntil,
        },
        feedbackFact({ occurredAt: feedbackAt }),
      ),
    ).resolves.toBe('applied')

    const rows = await db.execute(sql`
      SELECT created_at, expires_at
      FROM guest_response_session_bindings WHERE response_id = ${RESPONSE}
    `)
    expect(rows.rows).toHaveLength(1)
    expect(new Date(String(rows.rows[0]!.created_at))).toEqual(feedbackAt)
    expect(new Date(String(rows.rows[0]!.expires_at))).toEqual(renewedUntil)
  })

  it('purges private feedback and records its retraction without changing the rating', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const { originalRating, originalFeedback, persisted } = await arrangeSubmitted(store)
    const withdrawnAt = new Date('2026-08-25T12:30:00.000Z')
    const retraction = feedbackRetraction({
      supersedesSourceEventId: originalFeedback.eventId,
      occurredAt: withdrawnAt,
    })
    const withdrawn: GuestResponse = {
      ...persisted,
      text: null,
      textConsent: false,
      feedbackWithdrawnAt: withdrawnAt,
    }

    await expect(
      store.commitFeedbackWithdrawn(persisted, withdrawn, retraction),
    ).resolves.toBe('applied')
    await expect(
      store.commitFeedbackWithdrawn(persisted, withdrawn, retraction),
    ).resolves.toBe('conflict')

    const rows = await responseWithFeedbackRow(`
      r.status, r.rating, f.body AS response_text, r.text_consent,
      r.rating_source_event_id, r.feedback_source_event_id,
      r.feedback_submitted_at, r.feedback_withdrawn_at`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'submitted',
      rating: 2,
      response_text: null,
      text_consent: false,
      rating_source_event_id: originalRating.eventId,
      feedback_source_event_id: null,
    })
    expect(new Date(String(rows[0]!.feedback_submitted_at))).toEqual(NOW)
    expect(new Date(String(rows[0]!.feedback_withdrawn_at))).toEqual(withdrawnAt)
    expect(await outboxTypes('guest.feedback.retracted')).toEqual([
      'guest.feedback.retracted',
    ])
  })

  it('does not let a stale rating correction erase concurrently added feedback', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [rating] = facts()
    const ratingOnly = ratingOnlyResponse()
    await store.commitSubmitted(ratingOnly, [rating])
    const previouslyRead: GuestResponse = {
      ...ratingOnly,
      ratingSourceEventId: rating.eventId,
    }

    const feedback = feedbackFact()
    await store.commitFeedbackAdded(
      {
        ...previouslyRead,
        text: 'A concurrently committed private note.',
        textConsent: true,
        feedbackSubmittedAt: NOW,
        feedbackSubmissionRevision: 1,
        feedbackWithdrawnAt: null,
      },
      feedback,
    )

    const { correction, corrected } = ratingCorrection(previouslyRead)
    await expect(
      store.commitCorrected(previouslyRead, corrected, [correction]),
    ).resolves.toBe('conflict')

    expect(
      await responseWithFeedbackRow(
        `r.rating, f.body AS response_text, r.correction_count,
         r.feedback_source_event_id`,
      ),
    ).toEqual([
      {
        rating: 2,
        response_text: 'A concurrently committed private note.',
        correction_count: 0,
        feedback_source_event_id: feedback.eventId,
      },
    ])
  })

  it('commits the corrected response and superseding rating fact atomically', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const { originalFeedback, persisted } = await arrangeSubmitted(store)
    const { correction, corrected } = ratingCorrection(persisted)

    await expect(store.commitCorrected(persisted, corrected, [correction])).resolves.toBe(
      'applied',
    )
    expect(
      await responseRow(
        `rating, correction_count, rating_source_event_id,
         feedback_source_event_id`,
      ),
    ).toEqual([
      {
        rating: 4,
        correction_count: 1,
        rating_source_event_id: correction.eventId,
        feedback_source_event_id: originalFeedback.eventId,
      },
    ])
    const snapshot = await db.execute(sql`
      SELECT configuration_digest, private_feedback_threshold, captured_at
      FROM guest_response_experience_snapshots
      WHERE response_id = ${RESPONSE}
    `)
    expect(snapshot.rows).toHaveLength(1)
    expect(snapshot.rows[0]).toMatchObject({
      configuration_digest: 'a'.repeat(64),
      private_feedback_threshold: 3,
    })
    expect(new Date(String(snapshot.rows[0]!.captured_at))).toEqual(NOW)
    expect(await outboxTypes('guest.rating.submitted')).toHaveLength(2)
  })

  it('rejects a stale withdrawal that raced a committed correction', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const { originalRating, originalFeedback, correction } = await submitAndCorrect(store)

    const staleWithdrawal = deletedResponse(
      buildGuestResponse({
        ratingSourceEventId: originalRating.eventId,
        feedbackSourceEventId: originalFeedback.eventId,
      }),
      WITHDRAWN_AT,
    )
    const staleRetraction = ratingRetraction({
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: WITHDRAWN_AT,
    })

    await expect(store.commitWithdrawn(staleWithdrawal, [staleRetraction])).resolves.toBe(
      'conflict',
    )
    expect(
      await responseRow('status, rating, correction_count, rating_source_event_id'),
    ).toEqual([
      {
        status: 'corrected',
        rating: 4,
        correction_count: 1,
        rating_source_event_id: correction.eventId,
      },
    ])
    expect(await outboxTypes('guest.rating.retracted')).toHaveLength(0)
  })

  it('withdraws content and records rating/feedback retractions atomically', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const { originalRating, originalFeedback, persisted } = await arrangeSubmitted(store)
    const withdrawn = deletedResponse(persisted, WITHDRAWN_AT)

    await expect(
      store.commitWithdrawn(withdrawn, [
        ratingRetraction({
          supersedesSourceEventId: originalRating.eventId,
          occurredAt: WITHDRAWN_AT,
        }),
        feedbackRetraction({
          supersedesSourceEventId: originalFeedback.eventId,
          occurredAt: WITHDRAWN_AT,
        }),
      ]),
    ).resolves.toBe('applied')
    expect(
      await responseWithFeedbackRow(
        `r.status, r.rating, f.body AS response_text,
         r.rating_source_event_id, r.feedback_source_event_id`,
      ),
    ).toEqual([
      {
        status: 'deleted',
        rating: null,
        response_text: null,
        rating_source_event_id: null,
        feedback_source_event_id: null,
      },
    ])
    expect(
      await outboxTypes('guest.rating.retracted', 'guest.feedback.retracted'),
    ).toEqual(['guest.feedback.retracted', 'guest.rating.retracted'])
  })

  it("never changes the integrity of another organization's response", async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [otherRating, otherFeedback] = await commitOtherTenantResponse(store)
    // Response, Property, Portal and lineage all name the other tenant's
    // response; only the organization is the caller's own.
    const crossTenant: GuestResponse = {
      ...otherTenantResponse(),
      organizationId: ORG,
      ratingSourceEventId: otherRating.eventId,
      feedbackSourceEventId: otherFeedback.eventId,
    }
    const reviewedAt = new Date('2026-08-25T12:10:00.000Z')
    const excluded = excludeForReview(crossTenant, reviewedAt)
    const retraction = crossTenantRatingRetraction(otherRating.eventId, reviewedAt)

    await expect(
      store.commitIntegrityChanged(crossTenant, excluded.response, excluded.decision, [
        retraction,
      ]),
    ).resolves.toBe('conflict')

    await expectOtherTenantResponseUntouched([otherRating, otherFeedback])
  })

  it("never withdraws another organization's response", async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [otherRating, otherFeedback] = await commitOtherTenantResponse(store)
    const crossTenantWithdrawal = deletedResponse(
      {
        ...otherTenantResponse(),
        organizationId: ORG,
        ratingSourceEventId: otherRating.eventId,
        feedbackSourceEventId: otherFeedback.eventId,
      },
      WITHDRAWN_AT,
    )
    const retractions = [
      crossTenantRatingRetraction(otherRating.eventId, WITHDRAWN_AT),
      crossTenantFeedbackRetraction(otherFeedback.eventId, WITHDRAWN_AT),
    ]

    await expect(store.commitWithdrawn(crossTenantWithdrawal, retractions)).resolves.toBe(
      'conflict',
    )

    await expectOtherTenantResponseUntouched([otherRating, otherFeedback])
  })
})
