// Shared arrangement for the Guest response command store's integration
// suites: two tenants, the response they submit, its facts, and the SQL
// read-backs the assertions use.

import { createInMemoryWithdrawalJournal } from './guest-withdrawal-journal.test-fixtures'
import { sql } from 'drizzle-orm'
import { expect } from 'vitest'
import { testDb } from '#/shared/testing/ambient-test-runtime'
import { drizzleSeedRunner } from '#/shared/db/testing/drizzle-seed-runner'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { seedTenant } from '#/shared/testing/tenant-seeds'
import {
  feedbackId,
  guestResponseId,
  guestSessionId,
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
} from '../domain/events'
import type { GuestResponse } from '../domain/guest-response'
import { createAtomicGuestResponseCommandStore as createAtomicGuestResponseCommandStoreFactory } from './guest-response-command-store.server'
import { createGuestResponseRepository as createGuestResponseRepositoryFactory } from './guest-response.repository.server'

const db = testDb()
export const ORG = organizationId('org-guest-response-command-store')
export const PROPERTY = propertyId('51000000-0000-4000-8000-000000000001')
export const PORTAL = portalId('51000000-0000-4000-8000-000000000002')
export const RESPONSE = guestResponseId('51000000-0000-4000-8000-000000000003')
export const SESSION = guestSessionId('51000000-0000-4000-8000-000000000004')
export const STAFF_PARTICIPANT = '51000000-0000-4000-8000-000000000005'
const STAFF_PARTICIPANT_REPLACEMENT = '51000000-0000-4000-8000-000000000006'
export const STAFF_PARTICIPATION = '51000000-0000-4000-8000-000000000007'
export const STAFF_PARTICIPATION_REPLACEMENT = '51000000-0000-4000-8000-000000000008'
export const PORTAL_RESPONSIBILITY = '51000000-0000-4000-8000-000000000009'
export const PORTAL_RESPONSIBILITY_REPLACEMENT = '51000000-0000-4000-8000-000000000010'
export const NOW = new Date('2026-08-25T12:00:00.000Z')
const CORRECTED_AT = new Date('2026-08-25T12:30:00.000Z')
export const STAFF_EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z')
// A second tenant whose response the cross-tenant commands aim at.
const OTHER_ORG = organizationId('org-guest-response-command-store-other')
const OTHER_PROPERTY = propertyId('51000000-0000-4000-8000-000000000021')
const OTHER_PORTAL = portalId('51000000-0000-4000-8000-000000000022')
const OTHER_RESPONSE = guestResponseId('51000000-0000-4000-8000-000000000023')
const OTHER_SESSION = guestSessionId('51000000-0000-4000-8000-000000000024')

export const STAFF_ATTRIBUTION = {
  staffParticipantId: STAFF_PARTICIPANT,
  staffParticipationId: STAFF_PARTICIPATION,
  portalResponsibilityId: PORTAL_RESPONSIBILITY,
  effectiveFrom: STAFF_EFFECTIVE_FROM,
  effectiveTo: null,
} as const

/** Names the other tenant's response while the organization is the caller's own. */
const CROSS_TENANT_SCOPE = {
  organizationId: ORG,
  propertyId: OTHER_PROPERTY,
  portalId: OTHER_PORTAL,
} as const

export const createAtomicGuestResponseCommandStore = (
  database: Parameters<typeof createAtomicGuestResponseCommandStoreFactory>[0],
) =>
  createAtomicGuestResponseCommandStoreFactory(
    database,
    () => NOW,
    createInMemoryWithdrawalJournal(),
  )

export const createGuestResponseRepository = (
  database: Parameters<typeof createGuestResponseRepositoryFactory>[0],
  clock: () => Date = () => NOW,
) => createGuestResponseRepositoryFactory(database, clock)

type Store = ReturnType<typeof createAtomicGuestResponseCommandStore>

export function buildGuestResponse(
  overrides: Partial<GuestResponse> = {},
): GuestResponse {
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
    text: 'Please contact the front desk.',
    responseConsent: true,
    textConsent: true,
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
    ...overrides,
  }
}

/** The same submission, owned by the second tenant. */
export function otherTenantResponse(): GuestResponse {
  return buildGuestResponse({
    id: OTHER_RESPONSE,
    organizationId: OTHER_ORG,
    propertyId: OTHER_PROPERTY,
    portalId: OTHER_PORTAL,
    sessionId: OTHER_SESSION,
  })
}

/** The submission before its private feedback: no text and no feedback lineage. */
export function ratingOnlyResponse(
  overrides: Partial<GuestResponse> = {},
): GuestResponse {
  return buildGuestResponse({
    text: null,
    textConsent: false,
    feedbackSourceEventId: null,
    feedbackSubmittedAt: null,
    feedbackSubmissionRevision: null,
    feedbackWithdrawnAt: null,
    ...overrides,
  })
}

/** The response as a guest withdrawal leaves it. */
export function deletedResponse(base: GuestResponse, deletedAt: Date): GuestResponse {
  return {
    ...base,
    status: 'deleted',
    rating: null,
    text: null,
    responseConsent: false,
    textConsent: false,
    deletedAt,
  }
}

type Args<F extends (...args: never[]) => unknown> = Parameters<F>[0]
type ScopeKeys = 'organizationId' | 'propertyId' | 'portalId'
/** Fact input where the owner's scope (and subject id) default to the first tenant. */
type Scoped<A, K extends keyof A> = Omit<A, ScopeKeys | K> &
  Partial<Pick<A, (ScopeKeys | K) & keyof A>>

const OWN_SCOPE = { organizationId: ORG, propertyId: PROPERTY, portalId: PORTAL } as const

export const ratingFact = (
  overrides: Scoped<
    Args<typeof guestRatingSubmitted>,
    'ratingId' | 'value' | 'occurredAt'
  > = {},
) =>
  guestRatingSubmitted({
    ratingId: ratingId(RESPONSE),
    ...OWN_SCOPE,
    value: 2,
    occurredAt: NOW,
    ...overrides,
  })

export const ratingRetraction = (
  overrides: Scoped<Args<typeof guestRatingRetracted>, 'ratingId'>,
) => guestRatingRetracted({ ratingId: ratingId(RESPONSE), ...OWN_SCOPE, ...overrides })

export const feedbackFact = (
  overrides: Scoped<
    Args<typeof guestFeedbackSubmitted>,
    'feedbackId' | 'ratingId' | 'responseRevision' | 'occurredAt'
  > = {},
) =>
  guestFeedbackSubmitted({
    feedbackId: feedbackId(RESPONSE),
    ratingId: ratingId(RESPONSE),
    ...OWN_SCOPE,
    responseRevision: 1,
    occurredAt: NOW,
    ...overrides,
  })

export const feedbackRetraction = (
  overrides: Scoped<
    Args<typeof guestFeedbackRetracted>,
    'feedbackId' | 'responseRevision'
  >,
) =>
  guestFeedbackRetracted({
    feedbackId: feedbackId(RESPONSE),
    ...OWN_SCOPE,
    responseRevision: 1,
    ...overrides,
  })

/** A rating retraction aimed at the other tenant's response from the caller's organization. */
export const crossTenantRatingRetraction = (
  supersedesSourceEventId: string,
  occurredAt: Date,
) =>
  ratingRetraction({
    ratingId: ratingId(OTHER_RESPONSE),
    ...CROSS_TENANT_SCOPE,
    supersedesSourceEventId,
    occurredAt,
  })

export const crossTenantFeedbackRetraction = (
  supersedesSourceEventId: string,
  occurredAt: Date,
) =>
  feedbackRetraction({
    feedbackId: feedbackId(OTHER_RESPONSE),
    ...CROSS_TENANT_SCOPE,
    supersedesSourceEventId,
    occurredAt,
  })

export function facts(
  owner: GuestResponse = buildGuestResponse(),
): readonly [ReturnType<typeof ratingFact>, ReturnType<typeof feedbackFact>] {
  const scope = {
    organizationId: organizationId(owner.organizationId),
    propertyId: propertyId(owner.propertyId),
    portalId: portalId(owner.portalId),
  }
  return [
    ratingFact({ ratingId: ratingId(owner.id), ...scope }),
    feedbackFact({
      feedbackId: feedbackId(owner.id),
      ratingId: ratingId(owner.id),
      ...scope,
    }),
  ]
}

/**
 * Submit the rating, then add the private feedback, as the two staged commands
 * do. Resolves with the first outcome that is not 'applied'.
 */
export async function commitSubmittedWithFeedback(
  store: Store,
  response: GuestResponse = buildGuestResponse(),
  submissionFacts: ReturnType<typeof facts> = facts(response),
) {
  const [rating, feedback] = submissionFacts
  const submitted = await store.commitSubmitted(
    {
      ...response,
      text: null,
      textConsent: false,
      feedbackSubmittedAt: null,
      feedbackSubmissionRevision: null,
    },
    [rating],
  )
  if (submitted !== 'applied') return submitted
  return store.commitFeedbackAdded(
    { ...response, ratingSourceEventId: rating.eventId },
    feedback,
  )
}

/** Submit the default response with both facts; the response as persisted carries their ids. */
export async function arrangeSubmitted(store: Store) {
  const [originalRating, originalFeedback] = facts()
  await commitSubmittedWithFeedback(store, buildGuestResponse(), [
    originalRating,
    originalFeedback,
  ])
  const persisted = buildGuestResponse({
    ratingSourceEventId: originalRating.eventId,
    feedbackSourceEventId: originalFeedback.eventId,
  })
  return { originalRating, originalFeedback, persisted }
}

/** The single bounded rating correction (2 to 4) over a persisted response. */
export function ratingCorrection(persisted: GuestResponse) {
  const correction = ratingFact({
    value: 4,
    supersedesSourceEventId: persisted.ratingSourceEventId,
    occurredAt: CORRECTED_AT,
  })
  const corrected: GuestResponse = {
    ...persisted,
    status: 'corrected',
    rating: 4,
    correctionCount: 1,
    correctedAt: CORRECTED_AT,
  }
  return { correction, corrected }
}

export async function submitAndCorrect(store: Store) {
  const submitted = await arrangeSubmitted(store)
  const { correction, corrected } = ratingCorrection(submitted.persisted)
  await store.commitCorrected(submitted.persisted, corrected, [correction])
  return { ...submitted, correction }
}

/** Commit the second tenant's response through the store, as a real submission does. */
export async function commitOtherTenantResponse(store: Store) {
  const submissionFacts = facts(otherTenantResponse())
  await expect(
    commitSubmittedWithFeedback(store, otherTenantResponse(), submissionFacts),
  ).resolves.toBe('applied')
  return submissionFacts
}

/** The second tenant's response, feedback and integrity as its submission left them. */
export async function expectOtherTenantResponseUntouched(
  submissionFacts: ReturnType<typeof facts>,
) {
  const rows = await db.execute(sql`
    SELECT r.status, r.rating, r.integrity_outcome, r.integrity_revision,
           r.rating_source_event_id, r.feedback_source_event_id,
           f.body AS response_text
    FROM guest_responses r
    LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
    WHERE r.id = ${OTHER_RESPONSE}
  `)
  expect(rows.rows).toEqual([
    {
      status: 'submitted',
      rating: 2,
      integrity_outcome: 'accepted',
      integrity_revision: 1,
      rating_source_event_id: submissionFacts[0].eventId,
      feedback_source_event_id: submissionFacts[1].eventId,
      response_text: 'Please contact the front desk.',
    },
  ])
  const decisions = await db.execute(sql`
    SELECT revision FROM guest_response_integrity_decisions
    WHERE response_id = ${OTHER_RESPONSE}
  `)
  expect(decisions.rows).toEqual([{ revision: 1 }])
  const retractions = await db.execute(sql`
    SELECT id FROM outbox_events
    WHERE organization_id IN (${ORG}, ${OTHER_ORG})
      AND event_type IN ('guest.rating.retracted', 'guest.feedback.retracted')
  `)
  expect(retractions.rows).toHaveLength(0)
}

/** Event types in the first tenant's outbox, optionally only the named ones. */
export async function outboxTypes(...types: string[]) {
  const filter =
    types.length === 0
      ? sql``
      : sql`AND event_type IN (${sql.join(
          types.map((type) => sql`${type}`),
          sql`, `,
        )})`
  const rows = await db.execute(sql`
    SELECT event_type FROM outbox_events
    WHERE organization_id = ${ORG} ${filter}
    ORDER BY event_type
  `)
  return rows.rows.map((row) => row.event_type)
}

/** Columns of the default response's row (`id` when none are asked for). */
export async function responseRow(columns = 'id') {
  const rows = await db.execute(
    sql`SELECT ${sql.raw(columns)} FROM guest_responses WHERE id = ${RESPONSE}`,
  )
  return rows.rows
}

/** Columns of the default response joined to its separated private feedback body (`f.body`). */
export async function responseWithFeedbackRow(columns: string) {
  const rows = await db.execute(sql`
    SELECT ${sql.raw(columns)}
    FROM guest_responses r
    LEFT JOIN guest_response_private_feedback f ON f.response_id = r.id
    WHERE r.id = ${RESPONSE}
  `)
  return rows.rows
}

/** Both tenants with their Portals, and the Primary Staff the attribution test reassigns. */
export async function seedGuestResponseTenants(withStaff = false) {
  const runner = drizzleSeedRunner(db)
  await seedTenant(runner, {
    organizationId: ORG,
    organizationName: 'Guest Response Command Store',
    propertyId: PROPERTY,
    propertyName: 'Guest Command Property',
    propertySlug: 'guest-command-property',
    portalId: PORTAL,
    portalName: 'Guest Command Portal',
    portalSlug: 'guest-command-portal',
  })
  await seedTenant(runner, {
    organizationId: OTHER_ORG,
    organizationName: 'Guest Response Command Store Other',
    propertyId: OTHER_PROPERTY,
    propertyName: 'Guest Command Other Property',
    propertySlug: 'guest-command-other-property',
    portalId: OTHER_PORTAL,
    portalName: 'Guest Command Other Portal',
    portalSlug: 'guest-command-other-portal',
  })
  if (withStaff) await seedPrimaryStaff()
}

async function seedPrimaryStaff() {
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
}

/** Back to the seeded state: no responses or facts, the original responsibility open. */
export async function resetGuestResponseState() {
  await db.execute(
    sql`DELETE FROM guest_responses WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(sql`
    DELETE FROM portal_responsibilities
    WHERE id = ${PORTAL_RESPONSIBILITY_REPLACEMENT}::uuid
  `)
  await db.execute(sql`
    UPDATE portal_responsibilities
    SET effective_to = NULL, end_reason = NULL
    WHERE id = ${PORTAL_RESPONSIBILITY}::uuid
  `)
}

export async function deleteGuestResponseTenants() {
  await resetGuestResponseState()
  await db.execute(
    sql`DELETE FROM portal_responsibilities WHERE organization_id = ${ORG}`,
  )
  await db.execute(sql`DELETE FROM staff_participations WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM staff_participants WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM portals WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await db.execute(
    sql`DELETE FROM properties WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
  )
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
}
