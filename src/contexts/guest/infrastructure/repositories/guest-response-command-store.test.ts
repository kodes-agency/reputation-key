import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import {
  guestFeedbackRetracted,
  guestFeedbackSubmitted,
  guestRatingRetracted,
  guestRatingSubmitted,
} from '../../domain/events'
import type { GuestResponse } from '../../domain/guest-response'
import {
  changeGuestResponseIntegrity,
  initialGuestResponseIntegrityDecision,
  type GuestResponseInitialIntegrityAssessment,
} from '../../domain/guest-response-integrity'
import type { GuestSubmissionFact } from '../../application/ports/guest-response-command-store.port'
import { createAtomicGuestResponseCommandStore as createAtomicGuestResponseCommandStoreFactory } from '../guest-response-command-store'
import { createGuestResponseRepository as createGuestResponseRepositoryFactory } from './guest-response.repository'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'

const db = getDb()
const ORG = organizationId('org-guest-response-command-store')
const PROPERTY = propertyId('51000000-0000-4000-8000-000000000001')
const PORTAL = portalId('51000000-0000-4000-8000-000000000002')
const RESPONSE = '51000000-0000-4000-8000-000000000003'
const SESSION = '51000000-0000-4000-8000-000000000004'
const STAFF_PARTICIPANT = '51000000-0000-4000-8000-000000000005'
const STAFF_PARTICIPANT_REPLACEMENT = '51000000-0000-4000-8000-000000000006'
const STAFF_PARTICIPATION = '51000000-0000-4000-8000-000000000007'
const STAFF_PARTICIPATION_REPLACEMENT = '51000000-0000-4000-8000-000000000008'
const PORTAL_RESPONSIBILITY = '51000000-0000-4000-8000-000000000009'
const PORTAL_RESPONSIBILITY_REPLACEMENT = '51000000-0000-4000-8000-000000000010'
const NOW = new Date('2026-08-25T12:00:00.000Z')
const STAFF_EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z')

const createAtomicGuestResponseCommandStore = (
  database: Parameters<typeof createAtomicGuestResponseCommandStoreFactory>[0],
  events: Parameters<typeof createAtomicGuestResponseCommandStoreFactory>[1],
) => createAtomicGuestResponseCommandStoreFactory(database, events, () => NOW)

const createGuestResponseRepository = (
  database: Parameters<typeof createGuestResponseRepositoryFactory>[0],
  clock: () => Date = () => NOW,
) => createGuestResponseRepositoryFactory(database, clock)

const STAFF_ATTRIBUTION = {
  staffParticipantId: STAFF_PARTICIPANT,
  staffParticipationId: STAFF_PARTICIPATION,
  portalResponsibilityId: PORTAL_RESPONSIBILITY,
  effectiveFrom: STAFF_EFFECTIVE_FROM,
  effectiveTo: null,
} as const

function response(): GuestResponse {
  return {
    id: RESPONSE,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    staffAttribution: null,
    sessionId: SESSION,
    sessionExpiresAt: new Date('2026-08-26T12:00:00.000Z'),
    status: 'submitted',
    integrityOutcome: 'accepted',
    integrityReasonCode: 'initial_submission',
    integrityRevision: 1,
    integrityAssessedAt: NOW,
    rating: 2,
    category: null,
    text: 'Please contact the front desk.',
    responseConsent: true,
    textConsent: true,
    mediaConsent: false,
    privateFeedbackThreshold: 3,
    experienceSnapshot: {
      portalPublicationState: 'published',
      portalPublicationSnapshotId: null,
      portalPublicationVersion: null,
      portalPublicationDigest: null,
      portalConfigurationDigest: 'a'.repeat(64),
      guestLocale: 'en',
      languagePackVersion: 'guest-ui-en-v1',
      privateFeedbackThreshold: 3,
      capturedAt: NOW,
    },
    ratingSourceEventId: null,
    feedbackSourceEventId: null,
    correctionCount: 0,
    submittedAt: NOW,
    correctedAt: null,
    feedbackSubmittedAt: NOW,
    feedbackSubmissionRevision: 1,
    feedbackWithdrawnAt: null,
    moderatedAt: null,
    deletedAt: null,
    retentionDeadline: new Date('2028-08-25T12:00:00.000Z'),
    schemaVersion: 1,
  }
}

function facts(): readonly [
  ReturnType<typeof guestRatingSubmitted>,
  ReturnType<typeof guestFeedbackSubmitted>,
] {
  return [
    guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 2,
      occurredAt: NOW,
    }),
    guestFeedbackSubmitted({
      feedbackId: feedbackId(RESPONSE),
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      responseRevision: 1,
      occurredAt: NOW,
    }),
  ]
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Guest Response Command Store', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Guest Command Property', 'guest-command-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Guest Command Portal', 'guest-command-portal', 'published'
    ) ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO staff_participants (
      id, organization_id, display_name, status, revision, created_by,
      created_at, updated_at
    ) VALUES
      (${STAFF_PARTICIPANT}::uuid, ${ORG}, 'Original Primary', 'active', 1,
       'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM}),
      (${STAFF_PARTICIPANT_REPLACEMENT}::uuid, ${ORG}, 'Replacement Primary',
       'active', 1, 'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (
      id, organization_id, property_id, staff_participant_id, display_name,
      status, started_at, revision, created_by, created_at, updated_at
    ) VALUES
      (${STAFF_PARTICIPATION}::uuid, ${ORG}, ${PROPERTY},
       ${STAFF_PARTICIPANT}::uuid, 'Original Primary', 'active',
       ${STAFF_EFFECTIVE_FROM}, 1, 'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM}),
      (${STAFF_PARTICIPATION_REPLACEMENT}::uuid, ${ORG}, ${PROPERTY},
       ${STAFF_PARTICIPANT_REPLACEMENT}::uuid, 'Replacement Primary', 'active',
       ${STAFF_EFFECTIVE_FROM}, 1, 'test', ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO portal_responsibilities (
      id, organization_id, property_id, portal_id, staff_participation_id,
      kind, effective_from, created_by
    ) VALUES (
      ${PORTAL_RESPONSIBILITY}::uuid, ${ORG}, ${PROPERTY}, ${PORTAL},
      ${STAFF_PARTICIPATION}::uuid, 'primary', ${STAFF_EFFECTIVE_FROM}, 'test'
    )
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`
    DELETE FROM portal_responsibilities
    WHERE id = ${PORTAL_RESPONSIBILITY_REPLACEMENT}::uuid
  `)
  await db.execute(sql`
    UPDATE portal_responsibilities
    SET effective_to = NULL, end_reason = NULL
    WHERE id = ${PORTAL_RESPONSIBILITY}::uuid
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM portal_responsibilities WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM staff_participations WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM staff_participants WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe.sequential('atomic Guest response submission', () => {
  it('keeps the original Primary Staff snapshot through reassignment and correction', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const attributed = { ...response(), staffAttribution: STAFF_ATTRIBUTION }
    const originalRating = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 2,
      occurredAt: NOW,
      staffAttribution: STAFF_ATTRIBUTION,
    })
    const originalFeedback = guestFeedbackSubmitted({
      feedbackId: feedbackId(RESPONSE),
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      responseRevision: 1,
      occurredAt: NOW,
      staffAttribution: STAFF_ATTRIBUTION,
    })
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
    const correction = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
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

    const state = await db.execute(sql`
      SELECT attributed_staff_participant_id, attributed_staff_participation_id,
             attribution_responsibility_id, staff_attribution_effective_from,
             staff_attribution_effective_to
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({
      attributed_staff_participant_id: STAFF_PARTICIPANT,
      attributed_staff_participation_id: STAFF_PARTICIPATION,
      attribution_responsibility_id: PORTAL_RESPONSIBILITY,
      staff_attribution_effective_to: null,
    })
    expect(new Date(String(state.rows[0]!.staff_attribution_effective_from))).toEqual(
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

    await expect(
      db.execute(sql`
        UPDATE guest_responses
        SET attributed_staff_participant_id = ${STAFF_PARTICIPANT_REPLACEMENT}::uuid
        WHERE id = ${RESPONSE}
      `),
    ).rejects.toMatchObject({ cause: { code: '23514' } })
  })

  it('commits the response and both content-free facts together', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const submissionFacts = facts()

    await expect(store.commitSubmitted(response(), submissionFacts)).resolves.toBe(
      'applied',
    )

    const rows = await db.execute(sql`
      SELECT id, rating_source_event_id, feedback_source_event_id
      FROM guest_responses WHERE organization_id = ${ORG}
    `)
    const outbox = await db.execute(sql`
      SELECT event_type FROM outbox_events
      WHERE organization_id = ${ORG}
      ORDER BY event_type
    `)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({
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
      response().sessionExpiresAt,
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
    expect(outbox.rows.map((row) => row.event_type)).toEqual([
      'guest.feedback.submitted',
      'guest.rating.submitted',
    ])
    expect(events.capturedEvents).toHaveLength(2)
  })

  it('rolls back the response and earlier fact when any fact is invalid', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const [ratingFact, feedbackFact] = facts()
    const invalid = {
      ...feedbackFact,
      _tag: 'guest.feedback.unregistered',
    } as unknown as GuestSubmissionFact

    await expect(
      store.commitSubmitted(response(), [ratingFact, invalid]),
    ).rejects.toThrow('is not registered for the outbox')

    const rows = await db.execute(sql`
      SELECT id FROM guest_responses WHERE organization_id = ${ORG}
    `)
    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events WHERE organization_id = ${ORG}
    `)
    expect(rows.rows).toHaveLength(0)
    expect(outbox.rows).toHaveLength(0)
  })

  it('retains an automatic initial filter without publishing a rating fact', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const assessment: GuestResponseInitialIntegrityAssessment = {
      outcome: 'filtered_automatically',
      reasonCode: 'honeypot_signal',
      source: 'automatic',
      actorId: 'guest-integrity-honeypot-v1',
    }
    const filtered: GuestResponse = {
      ...response(),
      text: null,
      textConsent: false,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
      integrityOutcome: assessment.outcome,
      integrityReasonCode: assessment.reasonCode,
    }

    await expect(
      store.commitSubmitted(
        filtered,
        [],
        initialGuestResponseIntegrityDecision(filtered, assessment),
      ),
    ).resolves.toBe('applied')

    const rows = await db.execute(sql`
      SELECT rating, integrity_outcome, rating_source_event_id
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
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
    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events WHERE organization_id = ${ORG}
    `)
    expect(outbox.rows).toHaveLength(0)
    expect(events.capturedEvents).toHaveLength(0)

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
    const restoredRating = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 2,
      occurredAt: NOW,
    })
    await expect(
      store.commitIntegrityChanged(filtered, restored.response, restored.decision, [
        restoredRating,
      ]),
    ).resolves.toBe('applied')

    const restoredRow = await db.execute(sql`
      SELECT rating, integrity_outcome, integrity_assessed_at,
             rating_source_event_id
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(restoredRow.rows[0]).toMatchObject({
      rating: 2,
      integrity_outcome: 'accepted',
      rating_source_event_id: restoredRating.eventId,
    })
    expect(new Date(String(restoredRow.rows[0]!.integrity_assessed_at))).toEqual(
      reviewedAt,
    )
    expect(restoredRating.occurredAt).toEqual(NOW)
  })

  it('fails closed when a new submission has no experience snapshot', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())

    await expect(
      store.commitSubmitted({ ...response(), experienceSnapshot: null }, facts()),
    ).rejects.toThrow('Guest response submission snapshot is required')

    const rows = await db.execute(sql`
      SELECT id FROM guest_responses WHERE organization_id = ${ORG}
    `)
    expect(rows.rows).toHaveLength(0)
  })

  it('returns duplicate without emitting new facts for the session anchor', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    await store.commitSubmitted(response(), facts())
    events.clear()

    await expect(store.commitSubmitted(response(), facts())).resolves.toBe('duplicate')

    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events WHERE organization_id = ${ORG}
    `)
    expect(outbox.rows).toHaveLength(2)
    expect(events.capturedEvents).toHaveLength(0)
  })

  it('atomically audits eligibility changes and their correction facts', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const [originalRating, originalFeedback] = facts()
    await store.commitSubmitted(response(), [originalRating, originalFeedback])
    const persisted = {
      ...response(),
      ratingSourceEventId: originalRating.eventId,
      feedbackSourceEventId: originalFeedback.eventId,
    }
    const reviewedAt = new Date('2026-08-25T12:10:00.000Z')
    const excluded = changeGuestResponseIntegrity(
      persisted,
      {
        outcome: 'under_review',
        reasonCode: 'traffic_velocity_anomaly',
        source: 'automatic',
        actorId: 'guest-integrity-v1',
      },
      reviewedAt,
    )
    if ('code' in excluded) throw new Error(excluded.code)
    const retraction = guestRatingRetracted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
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

    const excludedRow = await db.execute(sql`
      SELECT rating, integrity_outcome, integrity_reason_code,
             integrity_revision, rating_source_event_id
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(excludedRow.rows).toEqual([
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
    const outbox = await db.execute(sql`
      SELECT event_type FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.rating.retracted'
    `)
    expect(outbox.rows).toHaveLength(1)
    expect(events.capturedByTag('guest.rating.retracted')).toHaveLength(1)
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
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    await store.commitSubmitted(response(), facts())
    const scope = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
    }
    const sessionExpiry = response().sessionExpiresAt!
    const feedbackExpiry = new Date('2026-11-23T12:00:00.000Z')

    await expect(
      createGuestResponseRepository(db).findForSession(
        scope,
        SESSION,
        new Date(sessionExpiry.getTime() - 1),
      ),
    ).resolves.toMatchObject({ sessionId: SESSION, text: response().text })
    await expect(
      createGuestResponseRepository(db).findForSession(scope, SESSION, sessionExpiry),
    ).resolves.toBeNull()

    await expect(
      createGuestResponseRepository(
        db,
        () => new Date(feedbackExpiry.getTime() - 1),
      ).findSnippetForOrg(ORG, RESPONSE),
    ).resolves.toMatchObject({ comment: response().text, ratingValue: 2 })
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
        cutoff: new Date(response().retentionDeadline.getTime() + 1),
      }),
    ).resolves.toMatchObject({ rowsDeleted: 1 })
  })

  it('adds private feedback atomically without consuming the rating correction', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const [ratingFact] = facts()
    const ratingOnly: GuestResponse = {
      ...response(),
      text: null,
      textConsent: false,
      feedbackSourceEventId: null,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
      feedbackWithdrawnAt: null,
    }
    await store.commitSubmitted(ratingOnly, [ratingFact])

    const feedbackFact = guestFeedbackSubmitted({
      feedbackId: feedbackId(RESPONSE),
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      responseRevision: 1,
      occurredAt: NOW,
    })
    const withFeedback: GuestResponse = {
      ...ratingOnly,
      ratingSourceEventId: ratingFact.eventId,
      text: 'Please contact the front desk.',
      textConsent: true,
      feedbackSubmittedAt: NOW,
      feedbackSubmissionRevision: 1,
      feedbackWithdrawnAt: null,
    }

    await expect(store.commitFeedbackAdded(withFeedback, feedbackFact)).resolves.toBe(
      'applied',
    )
    await expect(store.commitFeedbackAdded(withFeedback, feedbackFact)).resolves.toBe(
      'conflict',
    )

    const rows = await db.execute(sql`
      SELECT f.body AS response_text, r.feedback_source_event_id,
             r.correction_count
      FROM guest_responses r
      LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
      WHERE r.id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
      {
        response_text: 'Please contact the front desk.',
        feedback_source_event_id: feedbackFact.eventId,
        correction_count: 0,
      },
    ])
  })

  it('renews the separated recovery binding from a late feedback submission', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const [ratingFact] = facts()
    const ratingOnly: GuestResponse = {
      ...response(),
      text: null,
      textConsent: false,
      feedbackSourceEventId: null,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
    }
    await store.commitSubmitted(ratingOnly, [ratingFact])
    const feedbackAt = new Date('2026-08-26T11:00:00.000Z')
    const renewedUntil = new Date('2026-08-27T11:00:00.000Z')
    const fact = guestFeedbackSubmitted({
      feedbackId: feedbackId(RESPONSE),
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      responseRevision: 1,
      occurredAt: feedbackAt,
    })

    await expect(
      store.commitFeedbackAdded(
        {
          ...ratingOnly,
          ratingSourceEventId: ratingFact.eventId,
          text: 'Late private note.',
          textConsent: true,
          feedbackSubmittedAt: feedbackAt,
          feedbackSubmissionRevision: 1,
          sessionExpiresAt: renewedUntil,
        },
        fact,
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
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const [ratingFact, feedbackFact] = facts()
    await store.commitSubmitted(response(), [ratingFact, feedbackFact])
    const previous: GuestResponse = {
      ...response(),
      ratingSourceEventId: ratingFact.eventId,
      feedbackSourceEventId: feedbackFact.eventId,
    }
    const withdrawnAt = new Date('2026-08-25T12:30:00.000Z')
    const retraction = guestFeedbackRetracted({
      feedbackId: feedbackId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: feedbackFact.eventId,
      responseRevision: 1,
      occurredAt: withdrawnAt,
    })
    const withdrawn: GuestResponse = {
      ...previous,
      text: null,
      textConsent: false,
      feedbackWithdrawnAt: withdrawnAt,
    }

    await expect(
      store.commitFeedbackWithdrawn(previous, withdrawn, retraction),
    ).resolves.toBe('applied')
    await expect(
      store.commitFeedbackWithdrawn(previous, withdrawn, retraction),
    ).resolves.toBe('conflict')

    const rows = await db.execute(sql`
      SELECT r.status, r.rating, f.body AS response_text, r.text_consent,
             r.rating_source_event_id, r.feedback_source_event_id,
             r.feedback_submitted_at, r.feedback_withdrawn_at
      FROM guest_responses r
      LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
      WHERE r.id = ${RESPONSE}
    `)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({
      status: 'submitted',
      rating: 2,
      response_text: null,
      text_consent: false,
      rating_source_event_id: ratingFact.eventId,
      feedback_source_event_id: null,
    })
    expect(new Date(String(rows.rows[0]!.feedback_submitted_at))).toEqual(NOW)
    expect(new Date(String(rows.rows[0]!.feedback_withdrawn_at))).toEqual(withdrawnAt)
    const outbox = await db.execute(sql`
      SELECT event_type FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type = 'guest.feedback.retracted'
    `)
    expect(outbox.rows).toEqual([{ event_type: 'guest.feedback.retracted' }])
    expect(events.capturedByTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('does not let a stale rating correction erase concurrently added feedback', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const [ratingFact] = facts()
    const ratingOnly: GuestResponse = {
      ...response(),
      text: null,
      textConsent: false,
      feedbackSourceEventId: null,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
      feedbackWithdrawnAt: null,
    }
    await store.commitSubmitted(ratingOnly, [ratingFact])
    const previouslyRead: GuestResponse = {
      ...ratingOnly,
      ratingSourceEventId: ratingFact.eventId,
    }

    const feedbackFact = guestFeedbackSubmitted({
      feedbackId: feedbackId(RESPONSE),
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      responseRevision: 1,
      occurredAt: NOW,
    })
    await store.commitFeedbackAdded(
      {
        ...previouslyRead,
        text: 'A concurrently committed private note.',
        textConsent: true,
        feedbackSubmittedAt: NOW,
        feedbackSubmissionRevision: 1,
        feedbackWithdrawnAt: null,
      },
      feedbackFact,
    )

    const correctedAt = new Date('2026-08-25T12:30:00.000Z')
    const correctionFact = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 4,
      supersedesSourceEventId: ratingFact.eventId,
      occurredAt: correctedAt,
    })
    await expect(
      store.commitCorrected(
        previouslyRead,
        {
          ...previouslyRead,
          status: 'corrected',
          rating: 4,
          correctionCount: 1,
          correctedAt,
        },
        [correctionFact],
      ),
    ).resolves.toBe('conflict')

    const rows = await db.execute(sql`
      SELECT r.rating, f.body AS response_text, r.correction_count,
             r.feedback_source_event_id
      FROM guest_responses r
      LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
      WHERE r.id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
      {
        rating: 2,
        response_text: 'A concurrently committed private note.',
        correction_count: 0,
        feedback_source_event_id: feedbackFact.eventId,
      },
    ])
  })

  it('commits the corrected response and superseding rating fact atomically', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const [originalRating, originalFeedback] = facts()
    await store.commitSubmitted(response(), [originalRating, originalFeedback])

    const correctedAt = new Date('2026-08-25T12:30:00.000Z')
    const correction = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 4,
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: correctedAt,
    })
    const corrected: GuestResponse = {
      ...response(),
      status: 'corrected',
      rating: 4,
      correctionCount: 1,
      correctedAt,
      ratingSourceEventId: originalRating.eventId,
      feedbackSourceEventId: originalFeedback.eventId,
    }

    await expect(
      store.commitCorrected(
        {
          ...response(),
          ratingSourceEventId: originalRating.eventId,
          feedbackSourceEventId: originalFeedback.eventId,
        },
        corrected,
        [correction],
      ),
    ).resolves.toBe('applied')
    const rows = await db.execute(sql`
      SELECT rating, correction_count, rating_source_event_id,
             feedback_source_event_id
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
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
    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.rating.submitted'
      ORDER BY created_at
    `)
    expect(outbox.rows).toHaveLength(2)
  })

  it('rejects a stale withdrawal that raced a committed correction', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const [originalRating, originalFeedback] = facts()
    await store.commitSubmitted(response(), [originalRating, originalFeedback])

    const correctedAt = new Date('2026-08-25T12:30:00.000Z')
    const correction = guestRatingSubmitted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      value: 4,
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: correctedAt,
    })
    await store.commitCorrected(
      {
        ...response(),
        ratingSourceEventId: originalRating.eventId,
        feedbackSourceEventId: originalFeedback.eventId,
      },
      {
        ...response(),
        status: 'corrected',
        rating: 4,
        correctionCount: 1,
        correctedAt,
        ratingSourceEventId: originalRating.eventId,
        feedbackSourceEventId: originalFeedback.eventId,
      },
      [correction],
    )

    const deletedAt = new Date('2026-08-25T12:45:00.000Z')
    const staleWithdrawal: GuestResponse = {
      ...response(),
      status: 'deleted',
      rating: null,
      text: null,
      responseConsent: false,
      textConsent: false,
      deletedAt,
      ratingSourceEventId: originalRating.eventId,
      feedbackSourceEventId: originalFeedback.eventId,
    }
    const staleRetraction = guestRatingRetracted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: deletedAt,
    })

    await expect(
      store.commitWithdrawn(staleWithdrawal, [staleRetraction]),
    ).resolves.toEqual({ outcome: 'conflict', objectKeys: [] })
    const rows = await db.execute(sql`
      SELECT status, rating, correction_count, rating_source_event_id
      FROM guest_responses WHERE id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
      {
        status: 'corrected',
        rating: 4,
        correction_count: 1,
        rating_source_event_id: correction.eventId,
      },
    ])
    const retractions = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.rating.retracted'
    `)
    expect(retractions.rows).toHaveLength(0)
  })

  it('withdraws content and records rating/feedback retractions atomically', async () => {
    const store = createAtomicGuestResponseCommandStore(db, createCapturingEventBus())
    const [originalRating, originalFeedback] = facts()
    await store.commitSubmitted(response(), [originalRating, originalFeedback])
    const deletedAt = new Date('2026-08-25T12:45:00.000Z')
    const ratingRetraction = guestRatingRetracted({
      ratingId: ratingId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: originalRating.eventId,
      occurredAt: deletedAt,
    })
    const feedbackRetraction = guestFeedbackRetracted({
      feedbackId: feedbackId(RESPONSE),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: originalFeedback.eventId,
      responseRevision: 1,
      occurredAt: deletedAt,
    })
    const withdrawn: GuestResponse = {
      ...response(),
      status: 'deleted',
      rating: null,
      text: null,
      responseConsent: false,
      textConsent: false,
      deletedAt,
      ratingSourceEventId: originalRating.eventId,
      feedbackSourceEventId: originalFeedback.eventId,
    }

    await expect(
      store.commitWithdrawn(withdrawn, [ratingRetraction, feedbackRetraction]),
    ).resolves.toEqual({ outcome: 'applied', objectKeys: [] })
    const rows = await db.execute(sql`
      SELECT r.status, r.rating, f.body AS response_text,
             r.rating_source_event_id, r.feedback_source_event_id
      FROM guest_responses r
      LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
      WHERE r.id = ${RESPONSE}
    `)
    expect(rows.rows).toEqual([
      {
        status: 'deleted',
        rating: null,
        response_text: null,
        rating_source_event_id: null,
        feedback_source_event_id: null,
      },
    ])
    const outbox = await db.execute(sql`
      SELECT event_type FROM outbox_events
      WHERE organization_id = ${ORG}
        AND event_type IN ('guest.rating.retracted', 'guest.feedback.retracted')
      ORDER BY event_type
    `)
    expect(outbox.rows.map((row) => row.event_type)).toEqual([
      'guest.feedback.retracted',
      'guest.rating.retracted',
    ])
  })
})
