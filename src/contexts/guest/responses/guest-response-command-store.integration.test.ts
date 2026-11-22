import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  changeGuestResponseIntegrity,
  initialGuestResponseIntegrityDecision,
  type GuestResponseInitialIntegrityAssessment,
} from '../domain/guest-response-integrity'
import type { GuestResponse } from '../domain/guest-response'
import type { GuestSubmissionFact } from './guest-response-command-store.port.server'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import {
  NOW,
  ORG,
  PORTAL,
  PORTAL_RESPONSIBILITY,
  PORTAL_RESPONSIBILITY_REPLACEMENT,
  PROPERTY,
  RESPONSE,
  SESSION,
  STAFF_ATTRIBUTION,
  STAFF_EFFECTIVE_FROM,
  STAFF_PARTICIPANT,
  STAFF_PARTICIPATION,
  STAFF_PARTICIPATION_REPLACEMENT,
  arrangeSubmitted,
  buildGuestResponse,
  createAtomicGuestResponseCommandStore,
  createGuestResponseRepository,
  deleteGuestResponseTenants,
  excludeForReview,
  facts,
  feedbackFact,
  outboxTypes,
  ratingFact,
  ratingRetraction,
  resetGuestResponseState,
  responseRow,
  seedGuestResponseTenants,
} from './guest-response.test-fixtures'

const db = getDb()

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedGuestResponseTenants(true)
})

beforeEach(resetGuestResponseState)

afterAll(async () => {
  await deleteGuestResponseTenants()
  clearEventSchemas()
})

describe.sequential('atomic Guest response submission', () => {
  it('keeps the original Primary Staff snapshot through reassignment and correction', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const attributed = buildGuestResponse({ staffAttribution: STAFF_ATTRIBUTION })
    const originalRating = ratingFact({ staffAttribution: STAFF_ATTRIBUTION })
    const originalFeedback = feedbackFact({ staffAttribution: STAFF_ATTRIBUTION })
    await expect(
      store.commitSubmitted(attributed, [originalRating, originalFeedback]),
    ).resolves.toBe('applied')

    const reassignedAt = new Date('2026-08-26T00:00:00.000Z')
    await db.execute(sql`
      UPDATE portal_responsibilities
      SET effective_to = ${reassignedAt}, end_reason = 'reassigned'
      WHERE id = ${PORTAL_RESPONSIBILITY}::uuid
    `)
    await db.execute(sql`
      INSERT INTO portal_responsibilities (
        id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, created_by
      ) VALUES (
        ${PORTAL_RESPONSIBILITY_REPLACEMENT}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL},
        ${STAFF_PARTICIPATION_REPLACEMENT}::uuid, 'primary', ${reassignedAt}, 'test'
      )
    `)

    const correctedAt = new Date('2026-08-26T11:00:00.000Z')
    const correction = ratingFact({
      value: 4,
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: correctedAt,
      staffAttribution: STAFF_ATTRIBUTION,
    })
    const persisted = {
      ...attributed,
      ratingSourceEventId: originalRating.eventId,
      feedbackSourceEventId: originalFeedback.eventId,
    }
    await expect(
      store.commitCorrected(
        persisted,
        {
          ...persisted,
          status: 'corrected',
          rating: 4,
          correctionCount: 1,
          correctedAt,
        },
        [correction],
      ),
    ).resolves.toBe('applied')

    const state = await responseRow(`
      attributed_staff_participant_id, attributed_staff_participation_id,
      attribution_responsibility_id, staff_attribution_effective_from,
      staff_attribution_effective_to`)
    expect(state).toHaveLength(1)
    expect(state[0]).toMatchObject({
      attributed_staff_participant_id: STAFF_PARTICIPANT,
      attributed_staff_participation_id: STAFF_PARTICIPATION,
      attribution_responsibility_id: PORTAL_RESPONSIBILITY,
      staff_attribution_effective_to: null,
    })
    expect(new Date(String(state[0]!.staff_attribution_effective_from))).toEqual(
      STAFF_EFFECTIVE_FROM,
    )
    const durableFacts = await db.execute(sql`
      SELECT event_type, event_version, payload -> 'staffAttribution' AS attribution
      FROM outbox_events
      WHERE organization_id = ${ORG}
      ORDER BY created_at, event_type
    `)
    expect(durableFacts.rows).toHaveLength(3)
    for (const fact of durableFacts.rows) {
      expect(fact).toMatchObject({
        event_version: fact.event_type === 'guest.feedback.submitted' ? 3 : 2,
        attribution: {
          staffParticipantId: STAFF_PARTICIPANT,
          staffParticipationId: STAFF_PARTICIPATION,
          portalResponsibilityId: PORTAL_RESPONSIBILITY,
          effectiveFrom: STAFF_EFFECTIVE_FROM.toISOString(),
          effectiveTo: null,
        },
      })
    }
  })

  it('commits the response and both content-free facts together', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const submissionFacts = facts()

    await expect(
      store.commitSubmitted(buildGuestResponse(), submissionFacts),
    ).resolves.toBe('applied')

    const rows = await responseRow('id, rating_source_event_id, feedback_source_event_id')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rating_source_event_id: submissionFacts[0].eventId,
      feedback_source_event_id: submissionFacts[1].eventId,
    })
    const separated = await db.execute(sql`
      SELECT b.session_id, b.expires_at AS session_expires_at,
             f.body, f.expires_at AS feedback_expires_at
      FROM guest_response_session_bindings b
      JOIN guest_response_private_feedback f ON f.response_id = b.response_id
      WHERE b.response_id = ${RESPONSE}
    `)
    expect(separated.rows).toHaveLength(1)
    expect(separated.rows[0]).toMatchObject({
      session_id: SESSION,
      body: 'Please contact the front desk.',
    })
    expect(new Date(String(separated.rows[0]!.session_expires_at))).toEqual(
      buildGuestResponse().sessionExpiresAt,
    )
    expect(new Date(String(separated.rows[0]!.feedback_expires_at))).toEqual(
      new Date('2026-11-23T12:00:00.000Z'),
    )
    const snapshots = await db.execute(sql`
      SELECT publication_state, configuration_digest, guest_locale,
             language_pack_version, private_feedback_threshold, captured_at
      FROM guest_response_experience_snapshots
      WHERE response_id = ${RESPONSE}
    `)
    expect(snapshots.rows).toHaveLength(1)
    expect(snapshots.rows[0]).toMatchObject({
      publication_state: 'published',
      configuration_digest: 'a'.repeat(64),
      guest_locale: 'en',
      language_pack_version: 'guest-ui-en-v1',
      private_feedback_threshold: 3,
    })
    expect(new Date(String(snapshots.rows[0]!.captured_at))).toEqual(NOW)
    const integrity = await db.execute(sql`
      SELECT revision, previous_outcome, outcome, reason_code, source, actor_id,
             decided_at
      FROM guest_response_integrity_decisions
      WHERE response_id = ${RESPONSE}
    `)
    expect(integrity.rows).toHaveLength(1)
    expect(integrity.rows[0]).toMatchObject({
      revision: 1,
      previous_outcome: null,
      outcome: 'accepted',
      reason_code: 'initial_submission',
      source: 'system',
      actor_id: 'guest.gateway',
    })
    expect(new Date(String(integrity.rows[0]!.decided_at))).toEqual(NOW)
    expect(await outboxTypes()).toEqual([
      'guest.feedback.submitted',
      'guest.rating.submitted',
    ])
  })

  it('rolls back the response and earlier fact when any fact is invalid', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const [rating, feedback] = facts()
    const invalid = {
      ...feedback,
      _tag: 'guest.feedback.unregistered',
    } as unknown as GuestSubmissionFact

    await expect(
      store.commitSubmitted(buildGuestResponse(), [rating, invalid]),
    ).rejects.toThrow('is not registered for the outbox')

    expect(await responseRow()).toHaveLength(0)
    expect(await outboxTypes()).toHaveLength(0)
  })

  it('retains an automatic initial filter without recording a rating fact', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const assessment: GuestResponseInitialIntegrityAssessment = {
      outcome: 'filtered_automatically',
      reasonCode: 'honeypot_signal',
      source: 'automatic',
      actorId: 'guest-integrity-honeypot-v1',
    }
    const filtered: GuestResponse = buildGuestResponse({
      text: null,
      textConsent: false,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
      integrityOutcome: assessment.outcome,
      integrityReasonCode: assessment.reasonCode,
    })

    await expect(
      store.commitSubmitted(
        filtered,
        [],
        initialGuestResponseIntegrityDecision(filtered, assessment),
      ),
    ).resolves.toBe('applied')

    expect(
      await responseRow('rating, integrity_outcome, rating_source_event_id'),
    ).toEqual([
      {
        rating: 2,
        integrity_outcome: 'filtered_automatically',
        rating_source_event_id: null,
      },
    ])
    const decisions = await db.execute(sql`
      SELECT outcome, reason_code, source, actor_id
      FROM guest_response_integrity_decisions
      WHERE response_id = ${RESPONSE}
    `)
    expect(decisions.rows).toEqual([
      {
        outcome: 'filtered_automatically',
        reason_code: 'honeypot_signal',
        source: 'automatic',
        actor_id: 'guest-integrity-honeypot-v1',
      },
    ])
    expect(await outboxTypes()).toHaveLength(0)

    const reviewedAt = new Date('2026-08-27T09:00:00.000Z')
    const restored = changeGuestResponseIntegrity(
      filtered,
      {
        outcome: 'accepted',
        reasonCode: 'reviewer_restored',
        source: 'reviewer',
        actorId: 'reviewer-1',
      },
      reviewedAt,
    )
    if ('code' in restored) throw new Error(restored.code)
    const restoredRating = ratingFact()
    await expect(
      store.commitIntegrityChanged(filtered, restored.response, restored.decision, [
        restoredRating,
      ]),
    ).resolves.toBe('applied')

    const restoredRow = await responseRow(
      'rating, integrity_outcome, integrity_assessed_at, rating_source_event_id',
    )
    expect(restoredRow[0]).toMatchObject({
      rating: 2,
      integrity_outcome: 'accepted',
      rating_source_event_id: restoredRating.eventId,
    })
    expect(new Date(String(restoredRow[0]!.integrity_assessed_at))).toEqual(reviewedAt)
    expect(restoredRating.occurredAt).toEqual(NOW)
  })

  it('fails closed when a new submission has no experience snapshot', async () => {
    const store = createAtomicGuestResponseCommandStore(db)

    await expect(
      store.commitSubmitted(buildGuestResponse({ experienceSnapshot: null }), facts()),
    ).rejects.toThrow('Guest response submission snapshot is required')

    expect(await responseRow()).toHaveLength(0)
  })

  it('returns duplicate without recording new facts for the session anchor', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    await store.commitSubmitted(buildGuestResponse(), facts())

    await expect(store.commitSubmitted(buildGuestResponse(), facts())).resolves.toBe(
      'duplicate',
    )

    expect(await outboxTypes()).toHaveLength(2)
  })

  it('atomically audits eligibility changes and their correction facts', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    const { originalRating, persisted } = await arrangeSubmitted(store)
    const reviewedAt = new Date('2026-08-25T12:10:00.000Z')
    const excluded = excludeForReview(persisted, reviewedAt)
    const retraction = ratingRetraction({
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: reviewedAt,
    })

    await expect(
      store.commitIntegrityChanged(persisted, excluded.response, excluded.decision, [
        retraction,
      ]),
    ).resolves.toBe('applied')
    await expect(
      store.commitIntegrityChanged(persisted, excluded.response, excluded.decision, [
        retraction,
      ]),
    ).resolves.toBe('conflict')

    expect(
      await responseRow(
        `rating, integrity_outcome, integrity_reason_code,
         integrity_revision, rating_source_event_id`,
      ),
    ).toEqual([
      {
        rating: 2,
        integrity_outcome: 'under_review',
        integrity_reason_code: 'traffic_velocity_anomaly',
        integrity_revision: 2,
        rating_source_event_id: null,
      },
    ])
    const decisions = await db.execute(sql`
      SELECT revision, previous_outcome, outcome, reason_code, source, actor_id
      FROM guest_response_integrity_decisions
      WHERE response_id = ${RESPONSE}
      ORDER BY revision
    `)
    expect(decisions.rows).toEqual([
      {
        revision: 1,
        previous_outcome: null,
        outcome: 'accepted',
        reason_code: 'initial_submission',
        source: 'system',
        actor_id: 'guest.gateway',
      },
      {
        revision: 2,
        previous_outcome: 'accepted',
        outcome: 'under_review',
        reason_code: 'traffic_velocity_anomaly',
        source: 'automatic',
        actor_id: 'guest-integrity-v1',
      },
    ])
    expect(await outboxTypes('guest.rating.retracted')).toHaveLength(1)
  })

  it('summarizes current outcomes by corrected rating time with half-open bounds', async () => {
    const startAt = new Date('2026-08-25T00:00:00.000Z')
    const endAt = new Date('2026-08-26T00:00:00.000Z')
    const retention = new Date('2028-08-25T00:00:00.000Z')
    await db.execute(sql`
      INSERT INTO guest_responses (
        id, organization_id, property_id, portal_id, status,
        integrity_outcome, integrity_reason_code, integrity_revision,
        integrity_assessed_at, rating, response_consent, submitted_at,
        corrected_at, retention_deadline, deleted_at
      ) VALUES
        (
          '51000000-0000-4000-8000-000000000011', ${ORG}, ${PROPERTY}, ${PORTAL},
          'submitted', 'accepted', 'initial_submission', 1, ${NOW}, 5, true,
          ${NOW}, NULL, ${retention}, NULL
        ),
        (
          '51000000-0000-4000-8000-000000000012', ${ORG}, ${PROPERTY}, ${PORTAL},
          'corrected', 'filtered_automatically', 'honeypot_signal', 2, ${NOW},
          4, true, '2026-08-24T23:00:00.000Z', '2026-08-25T13:00:00.000Z',
          ${retention}, NULL
        ),
        (
          '51000000-0000-4000-8000-000000000013', ${ORG}, ${PROPERTY}, ${PORTAL},
          'submitted', 'under_review', 'traffic_velocity_anomaly', 2, ${NOW},
          3, true, ${endAt}, NULL, ${retention}, NULL
        ),
        (
          '51000000-0000-4000-8000-000000000014', ${ORG}, ${PROPERTY}, ${PORTAL},
          'deleted', 'accepted', 'initial_submission', 1, ${NOW}, 2, true,
          ${NOW}, NULL, ${retention}, ${NOW}
        )
    `)

    await expect(
      createGuestResponseRepository(db).summarizePortalIntegrity(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
        },
        startAt,
        endAt,
      ),
    ).resolves.toEqual({
      accepted: 1,
      filteredAutomatically: 1,
      underReview: 0,
      total: 2,
    })
  })

  it('denies stale reads and expires each storage class independently', async () => {
    const store = createAtomicGuestResponseCommandStore(db)
    await store.commitSubmitted(buildGuestResponse(), facts())
    const scope = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
    }
    const sessionExpiry = buildGuestResponse().sessionExpiresAt!
    const feedbackExpiry = new Date('2026-11-23T12:00:00.000Z')

    await expect(
      createGuestResponseRepository(db).findForSession(
        scope,
        SESSION,
        new Date(sessionExpiry.getTime() - 1),
      ),
    ).resolves.toMatchObject({ sessionId: SESSION, text: buildGuestResponse().text })
    await expect(
      createGuestResponseRepository(db).findForSession(scope, SESSION, sessionExpiry),
    ).resolves.toBeNull()

    await expect(
      createGuestResponseRepository(
        db,
        () => new Date(feedbackExpiry.getTime() - 1),
      ).findSnippetForOrg(ORG, RESPONSE),
    ).resolves.toMatchObject({ comment: buildGuestResponse().text, ratingValue: 2 })
    await expect(
      createGuestResponseRepository(db, () => feedbackExpiry).findSnippetForOrg(
        ORG,
        RESPONSE,
      ),
    ).resolves.toMatchObject({ comment: null, ratingValue: 2 })

    const rule = (subject: string) => {
      const found = RETENTION_RULES.find((candidate) => candidate.subject === subject)
      if (!found) throw new Error(`Missing retention rule: ${subject}`)
      return found
    }
    await expect(
      executeRetentionRule(db, rule('guest_response_session_bindings.expired'), {
        cutoff: sessionExpiry,
      }),
    ).resolves.toMatchObject({ rowsDeleted: 0 })
    await expect(
      executeRetentionRule(db, rule('guest_response_session_bindings.expired'), {
        cutoff: new Date(sessionExpiry.getTime() + 1),
      }),
    ).resolves.toMatchObject({ rowsDeleted: 1 })
    await expect(
      executeRetentionRule(db, rule('guest_response_private_feedback.expired'), {
        cutoff: new Date(feedbackExpiry.getTime() + 1),
      }),
    ).resolves.toMatchObject({ rowsDeleted: 1 })
    expect(
      (
        await db.execute(sql`
          SELECT count(*)::int AS count FROM guest_responses WHERE id = ${RESPONSE}
        `)
      ).rows,
    ).toEqual([{ count: 1 }])
    await expect(
      executeRetentionRule(db, rule('guest_responses.deidentified_fact'), {
        cutoff: new Date(buildGuestResponse().retentionDeadline.getTime() + 1),
      }),
    ).resolves.toMatchObject({ rowsDeleted: 1 })
  })
})
