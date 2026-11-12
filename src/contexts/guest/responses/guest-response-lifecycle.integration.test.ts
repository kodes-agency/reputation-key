import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { GuestResponseStatus } from '../domain/guest-response'
import type { GuestResponseScope } from '../application/ports/guest-response.repository'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  guestSessionId,
  organizationId,
  portalId,
  propertyId,
  type GuestSessionId,
} from '#/shared/domain/ids'
import {
  GuestResponseLifecycleError,
  guestResponseLifecycle,
  type OperatorErasureAuthority,
} from './guest-response-lifecycle.server'
import {
  canStartNewGuestResponse,
  isQualifiedGuestResponse,
  type GuestResponseView,
} from './contracts'
import { createAtomicGuestResponseCommandStore } from './guest-response-command-store.server'
import { createGuestResponseRepository } from './guest-response.repository.server'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

const db = getDb()
const STAFF_EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z')
const createdOrganizations: string[] = []

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  const ids = createdOrganizations
  if (ids.length > 0) {
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )
    await db.execute(sql`DELETE FROM guest_responses WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id IN (${list})`)
    await db.execute(
      sql`DELETE FROM portal_responsibilities WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM staff_participations WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM staff_participants WHERE organization_id IN (${list})`,
    )
    await db.execute(
      sql`DELETE FROM portal_publication_snapshots WHERE organization_id IN (${list})`,
    )
    await db.execute(sql`DELETE FROM portals WHERE organization_id IN (${list})`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id IN (${list})`)
    await deleteTestOrganizations(db, ids)
  }
  clearEventSchemas()
})

const experienceFor =
  (snapshotId: string) =>
  (privateFeedbackThreshold = 3) => ({
    portalPublicationState: 'published' as const,
    portalPublicationSnapshotId: snapshotId,
    portalPublicationVersion: 1,
    portalPublicationDigest: 'b'.repeat(64),
    portalConfigurationDigest: 'a'.repeat(64),
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v1',
    privateFeedbackThreshold,
  })

/** A tenant of its own, so harnesses and files never meet in one table row. */
async function seedTenant(): Promise<{
  scope: GuestResponseScope
  staffAttribution: PrimaryStaffAttributionSnapshot
  experience: ReturnType<typeof experienceFor>
  snapshot: string
}> {
  const org = `org-guest-lifecycle-${randomUUID()}`
  const property = randomUUID()
  const portal = randomUUID()
  const participant = randomUUID()
  const participation = randomUUID()
  const responsibility = randomUUID()
  const snapshot = randomUUID()
  createdOrganizations.push(org)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${org}, 'Guest Lifecycle', ${org}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${property}, ${org}, 'Guest Lifecycle Property', ${property}, 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${portal}, ${org}, ${property}, 'property', ${property},
      'Guest Lifecycle Portal', ${portal}, 'published'
    )
  `)
  await db.execute(sql`
    INSERT INTO portal_publication_snapshots (
      id, organization_id, property_id, portal_id, version, configuration_digest,
      configuration, guest_locale, language_pack_version, private_feedback_threshold,
      contact_request_enabled, destination_uri, destination_retrieved_at,
      destination_source_epoch, destination_profile_version, created_by, created_at
    ) VALUES (
      ${snapshot}::uuid, ${org}, ${property}::uuid, ${portal}::uuid, 1, ${'b'.repeat(64)},
      '{}'::jsonb, 'en', 'guest-ui-en-v1', 3, false, 'https://example.test/review',
      now(), 0, 1, 'test', now()
    )
  `)
  await db.execute(sql`
    INSERT INTO staff_participants (
      id, organization_id, display_name, status, revision, created_by,
      created_at, updated_at
    ) VALUES (${participant}::uuid, ${org}, 'Primary', 'active', 1, 'test',
      ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (
      id, organization_id, property_id, staff_participant_id, display_name,
      status, started_at, revision, created_by, created_at, updated_at
    ) VALUES (${participation}::uuid, ${org}, ${property}, ${participant}::uuid,
      'Primary', 'active', ${STAFF_EFFECTIVE_FROM}, 1, 'test',
      ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO portal_responsibilities (
      id, organization_id, property_id, portal_id, staff_participation_id,
      kind, effective_from, created_by
    ) VALUES (${responsibility}::uuid, ${org}, ${property}, ${portal},
      ${participation}::uuid, 'primary', ${STAFF_EFFECTIVE_FROM}, 'test')
  `)
  return {
    scope: {
      organizationId: organizationId(org),
      propertyId: propertyId(property),
      portalId: portalId(portal),
    },
    snapshot,
    experience: experienceFor(snapshot),
    staffAttribution: {
      staffParticipantId: participant,
      staffParticipationId: participation,
      portalResponsibilityId: responsibility,
      effectiveFrom: STAFF_EFFECTIVE_FROM,
      effectiveTo: null,
    },
  }
}

async function harness(
  clock: () => Date = () => new Date('2026-08-09T12:00:00Z'),
  operatorAuthority?: OperatorErasureAuthority,
) {
  const { scope, staffAttribution, experience, snapshot } = await seedTenant()
  const repo = createGuestResponseRepository(db, clock)
  let resolvedStaffAttribution: PrimaryStaffAttributionSnapshot | null = staffAttribution
  let staffAttributionResolutionCount = 0
  // The bucket is a provider transport: record what would be written, in order.
  const journalWrites: string[] = []
  const journal = operatorAuthority
    ? {
        idGen: () => randomUUID(),
        alert: () => undefined,
        put: async (key: string) => {
          journalWrites.push(key)
        },
      }
    : undefined
  const rawLifecycle = guestResponseLifecycle({
    repo,
    clock,
    idGen: () => randomUUID(),
    commandStore: createAtomicGuestResponseCommandStore(db, clock, journal),
    operatorAuthority,
    resolvePrimaryStaffAttribution: async () => {
      staffAttributionResolutionCount += 1
      return resolvedStaffAttribution
    },
  })
  // Most lifecycle tests focus on behavior after submission. This adapter keeps
  // their threshold-oriented call shape compact while production callers must
  // provide the complete server-resolved experience contract.
  const lifecycle = {
    ...rawLifecycle,
    submit: (
      candidateScope: GuestResponseScope,
      sessionId: GuestSessionId,
      input: Parameters<typeof rawLifecycle.submit>[2],
      privateFeedbackThreshold = 3,
      sessionExpiresAt?: Date,
    ) =>
      rawLifecycle.submit(
        candidateScope,
        sessionId,
        input,
        experience(privateFeedbackThreshold),
        sessionExpiresAt,
      ),
  }
  const responseIds = async () =>
    (
      await db.execute(
        sql`SELECT id FROM guest_responses WHERE organization_id = ${scope.organizationId}`,
      )
    ).rows.map((row) => String(row.id))
  const READ_AS_OF = new Date('2026-08-09T00:00:00Z')
  // Read as of a moment before any expiry, so a lapsed binding or note never hides what is stored.
  const readRepo = createGuestResponseRepository(db, () => READ_AS_OF)
  /** The tenant's single stored response, read back through the repository. */
  const stored = async () => {
    const ids = await responseIds()
    expect(ids).toHaveLength(1)
    const bound = await db.execute(
      sql`SELECT session_id FROM guest_response_session_bindings WHERE response_id = ${ids[0]}::uuid`,
    )
    const sessionRow = bound.rows[0]
    const found = sessionRow
      ? await readRepo.findForSession(
          scope,
          guestSessionId(String(sessionRow.session_id)),
          READ_AS_OF,
        )
      : await readRepo.findById(scope, ids[0]! as never)
    return found!
  }
  /** Keep the guest's session and note alive past the clock the test moves to. */
  const keepSessionBound = async () => {
    await db.execute(
      sql`UPDATE guest_response_session_bindings SET expires_at = '2027-01-01T00:00:00Z' WHERE organization_id = ${scope.organizationId}`,
    )
    await db.execute(
      sql`UPDATE guest_response_private_feedback SET expires_at = '2027-01-01T00:00:00Z' WHERE organization_id = ${scope.organizationId}`,
    )
  }
  /** Facts the commands committed to the outbox, in commit order. */
  const byTag = async (tag: string) =>
    (
      await db.execute(sql`
        SELECT id, payload FROM outbox_events
        WHERE organization_id = ${scope.organizationId} AND event_type = ${tag}
        ORDER BY created_at, id
      `)
    ).rows.map((row) => ({
      ...(row.payload as Record<string, unknown>),
      eventId: String(row.id),
    })) as Array<Record<string, unknown> & { eventId: string }>
  return {
    scope,
    lifecycle,
    rawLifecycle,
    repo,
    stored,
    keepSessionBound,
    count: async () => (await responseIds()).length,
    outbox: { byTag },
    snapshot,
    experience,
    journalWrites,
    staffAttribution,
    setStaffAttribution: (value: PrimaryStaffAttributionSnapshot | null) => {
      resolvedStaffAttribution = value
    },
    staffAttributionResolutionCount: () => staffAttributionResolutionCount,
  }
}

describe('guest response lifecycle', () => {
  it('copies initial Staff attribution through later correction facts without re-resolving', async () => {
    const test = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000099')

    await test.lifecycle.submit(
      test.scope,
      sessionId,
      { rating: 5, responseConsent: true },
      3,
    )
    test.setStaffAttribution({
      staffParticipantId: '20000000-0000-4000-8000-000000000001',
      staffParticipationId: '20000000-0000-4000-8000-000000000002',
      portalResponsibilityId: '20000000-0000-4000-8000-000000000003',
      effectiveFrom: new Date('2026-08-09T12:00:00.001Z'),
      effectiveTo: null,
    })

    await test.lifecycle.correct(test.scope, sessionId, {
      rating: 4,
      responseConsent: true,
    })

    const serializedAttribution = JSON.parse(JSON.stringify(test.staffAttribution))
    expect(test.staffAttributionResolutionCount()).toBe(1)
    expect((await test.stored()).staffAttribution).toEqual(test.staffAttribution)
    expect(await test.outbox.byTag('guest.rating.submitted')).toMatchObject([
      { staffAttribution: serializedAttribution },
      { staffAttribution: serializedAttribution },
    ])
  })

  it('pins exact session expiry separately from the 24-month fact deadline', async () => {
    const { scope, lifecycle, stored, snapshot } = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    const sessionExpiresAt = new Date('2026-08-10T12:00:00.000Z')

    await lifecycle.submit(
      scope,
      sessionId,
      { rating: 5, responseConsent: true },
      3,
      sessionExpiresAt,
    )

    expect(await stored()).toMatchObject({
      sessionId,
      sessionExpiresAt,
      retentionDeadline: new Date('2028-08-09T12:00:00.000Z'),
      experienceSnapshot: {
        portalPublicationState: 'published',
        portalPublicationSnapshotId: snapshot,
        portalPublicationVersion: 1,
        portalPublicationDigest: 'b'.repeat(64),
        portalConfigurationDigest: 'a'.repeat(64),
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
        capturedAt: new Date('2026-08-09T12:00:00.000Z'),
      },
    })
  })

  it('rejects expired or overlong recovery bindings', async () => {
    const { scope, lifecycle } = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    for (const expiresAt of [
      new Date('2026-08-09T12:00:00.000Z'),
      new Date('2026-08-10T12:00:00.001Z'),
    ]) {
      await expect(
        lifecycle.submit(
          scope,
          sessionId,
          { rating: 5, responseConsent: true },
          3,
          expiresAt,
        ),
      ).rejects.toMatchObject({ code: 'response_unavailable' })
    }
  })

  it.each([
    { portalPublicationState: 'disabled' },
    { portalConfigurationDigest: 'not-a-digest' },
    { guestLocale: 'en--US' },
    { languagePackVersion: 'Guest UI V1' },
    { privateFeedbackThreshold: 0 },
    { privateFeedbackThreshold: 6 },
  ])('rejects an invalid server-resolved experience: %o', async (override) => {
    const { scope, experience, rawLifecycle, count } = await harness()
    await expect(
      rawLifecycle.submit(
        scope,
        guestSessionId('00000000-0000-4000-8000-000000000003'),
        { rating: 5, responseConsent: true },
        { ...experience(), ...override } as Parameters<typeof rawLifecycle.submit>[3],
      ),
    ).rejects.toMatchObject({ code: 'response_unavailable' })
    expect(await count()).toBe(0)
  })

  it('retains an automatically filtered submission without recording a rating fact', async () => {
    const { scope, experience, rawLifecycle, stored, outbox } = await harness()
    const receipt = await rawLifecycle.submit(
      scope,
      guestSessionId('00000000-0000-4000-8000-000000000003'),
      { rating: 5, responseConsent: true },
      experience(),
      undefined,
      {
        outcome: 'filtered_automatically',
        reasonCode: 'honeypot_signal',
        source: 'automatic',
        actorId: 'guest-integrity-honeypot-v1',
      },
    )

    expect(receipt).toMatchObject({ status: 'submitted', rating: 5 })
    expect(receipt).not.toHaveProperty('integrityOutcome')
    expect(await stored()).toMatchObject({
      rating: 5,
      integrityOutcome: 'filtered_automatically',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(0)
  })

  it('keeps a rating filtered for network volume: durable, in the normal view, out of the figures', async () => {
    // A venue's guests share one public address, so a rating past the network
    // layer's budget is kept and filtered automatically instead of refused.
    const { scope, experience, rawLifecycle, stored, outbox } = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    const receipt = await rawLifecycle.submit(
      scope,
      sessionId,
      { rating: 4, responseConsent: true },
      experience(),
      undefined,
      {
        outcome: 'filtered_automatically',
        reasonCode: 'network_volume',
        source: 'automatic',
        actorId: 'guest-integrity-network-v1',
      },
    )

    expect(receipt).toMatchObject({ status: 'submitted', rating: 4 })
    expect(receipt).not.toHaveProperty('integrityOutcome')
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'filtered_automatically',
      integrityReasonCode: 'network_volume',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(0)
    // Durable: the guest's session now holds a rating, so the Google step opens.
    expect(isQualifiedGuestResponse(await rawLifecycle.getState(scope, sessionId))).toBe(
      true,
    )
  })

  it('answers a network-volume rating exactly as an accepted one, and lets the guest go on', async () => {
    // The guest on a busy venue's Wi-Fi must get the page an accepted rating gets,
    // and a script crossing the budget must learn nothing from the answer.
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    const input = { rating: 2, responseConsent: true }
    const accepted = await harness()
    const filtered = await harness()

    const acceptedView = await accepted.rawLifecycle.submit(
      accepted.scope,
      sessionId,
      input,
      accepted.experience(),
    )
    const filteredView = await filtered.rawLifecycle.submit(
      filtered.scope,
      sessionId,
      input,
      filtered.experience(),
      undefined,
      {
        outcome: 'filtered_automatically',
        reasonCode: 'network_volume',
        source: 'automatic',
        actorId: 'guest-integrity-network-v1',
      },
    )
    expect(filteredView).toEqual(acceptedView)
    expect(filteredView.privateFeedbackEligible).toBe(true)

    // The one correction and the private note both go through; the rating
    // still records no reading, and the note reaches the manager.
    await expect(
      filtered.rawLifecycle.correct(filtered.scope, sessionId, { rating: 1 }),
    ).resolves.toMatchObject({ status: 'corrected', rating: 1 })
    await expect(
      filtered.rawLifecycle.addPrivateFeedback(filtered.scope, sessionId, {
        text: 'The lobby Wi-Fi kept dropping.',
        textConsent: true,
      }),
    ).resolves.toMatchObject({ hasPrivateFeedback: true })
    expect(await filtered.outbox.byTag('guest.rating.submitted')).toHaveLength(0)
    expect(await filtered.outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    expect(await filtered.outbox.byTag('guest.feedback.submitted')).toHaveLength(1)
  })

  it('submits, corrects once, and withdraws only for the same session', async () => {
    const { scope, lifecycle } = await harness()
    const submitted = await lifecycle.submit(
      scope,
      guestSessionId('00000000-0000-4000-8000-000000000003'),
      {
        rating: 5,
        responseConsent: true,
      },
    )
    expect(submitted.status).toBe('submitted')
    expect(submitted.correctionAvailable).toBe(true)
    const corrected = await lifecycle.correct(
      scope,
      guestSessionId('00000000-0000-4000-8000-000000000003'),
      { rating: 4 },
    )
    expect(corrected.status).toBe('corrected')
    expect(corrected.correctionAvailable).toBe(false)
    await expect(
      lifecycle.correct(scope, guestSessionId('00000000-0000-4000-8000-000000000003'), {
        rating: 3,
      }),
    ).rejects.toMatchObject({ code: 'already_submitted' })
    await expect(
      lifecycle.withdraw(scope, guestSessionId('00000000-0000-4000-8000-000000000099')),
    ).rejects.toBeInstanceOf(GuestResponseLifecycleError)
    const withdrawn = await lifecycle.withdraw(
      scope,
      guestSessionId('00000000-0000-4000-8000-000000000003'),
    )
    expect(withdrawn).toMatchObject({ status: 'deleted', rating: null })
    expect('text' in withdrawn).toBe(false)
  })

  it('stops advertising correction at the exact one-hour boundary plus one millisecond', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle } = await harness(() => now)
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })

    now = new Date('2026-08-09T13:00:00.000Z')
    await expect(lifecycle.getState(scope, sessionId)).resolves.toMatchObject({
      correctionAvailable: true,
    })

    now = new Date('2026-08-09T13:00:00.001Z')
    await expect(lifecycle.getState(scope, sessionId)).resolves.toMatchObject({
      correctionAvailable: false,
    })
  })

  it('rejects another tenant without revealing the response', async () => {
    const { scope, lifecycle } = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })
    await expect(
      lifecycle.withdraw(
        { ...scope, organizationId: organizationId('org-2') },
        sessionId,
      ),
    ).rejects.toMatchObject({ code: 'response_not_found' })
  })

  it('excludes an anomaly from metrics, preserves its rating, and restores the corrected value', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, stored, outbox } = await harness(() => now)
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
    await lifecycle.submit(scope, sessionId, { rating: 2, responseConsent: true })
    const responseId = (await stored()).id
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    now = new Date('2026-08-09T12:10:00.000Z')
    await expect(
      lifecycle.changeIntegrity(scope, responseId, {
        outcome: 'under_review',
        reasonCode: 'traffic_velocity_anomaly',
        source: 'automatic',
        actorId: 'guest-integrity-v1',
      }),
    ).resolves.toMatchObject({
      revision: 2,
      previousOutcome: 'accepted',
      outcome: 'under_review',
    })
    expect(await stored()).toMatchObject({
      rating: 2,
      integrityOutcome: 'under_review',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { supersedesSourceEventId: original.eventId },
    ])

    now = new Date('2026-08-09T12:20:00.000Z')
    await lifecycle.correct(scope, sessionId, { rating: 4 })
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'under_review',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)

    now = new Date('2026-08-09T12:30:00.000Z')
    await lifecycle.changeIntegrity(scope, responseId, {
      outcome: 'accepted',
      reasonCode: 'reviewer_restored',
      source: 'reviewer',
      actorId: 'reviewer-1',
    })
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'accepted',
      integrityRevision: 3,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(2)
    expect((await outbox.byTag('guest.rating.submitted'))[1]).toMatchObject({
      value: 4,
      supersedesSourceEventId: null,
      occurredAt: '2026-08-09T12:20:00.000Z',
    })
  })
})

// The submit path is the only producer of the guest rating/feedback facts the
// metric handlers consume (portal.rating, portal.feedback). These pin the
// producer: without them both metrics silently read 0 again.
describe('guest response lifecycle — submitted facts', () => {
  const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')

  it('records rating then feedback facts from the two staged commands', async () => {
    const { scope, lifecycle, outbox, stored } = await harness()

    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    const withFeedback = await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up with the property team.',
      textConsent: true,
    })
    const responseId = (await stored()).id

    expect(await outbox.byTag('guest.rating.submitted')).toMatchObject([
      {
        ratingId: responseId,
        organizationId: scope.organizationId,
        portalId: scope.portalId,
        propertyId: scope.propertyId,
        value: 2,
      },
    ])
    expect(await outbox.byTag('guest.feedback.submitted')).toMatchObject([
      { feedbackId: responseId, ratingId: responseId, responseRevision: 1 },
    ])
    expect(withFeedback).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
    expect('text' in withFeedback).toBe(false)
  })

  it('records no feedback fact when the guest supplied no free text', async () => {
    const { scope, lifecycle, outbox } = await harness()

    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })

    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
    expect(await outbox.byTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('renews recovery for 24 hours from late feedback without duplicating it', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored } = await harness(() => now)
    await lifecycle.submit(scope, sessionId, { rating: 2, responseConsent: true })
    now = new Date('2026-08-10T11:00:00.000Z')

    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Late but still within the original recovery session.',
      textConsent: true,
    })
    expect((await stored()).sessionExpiresAt).toEqual(
      new Date('2026-08-11T11:00:00.000Z'),
    )
    await expect(
      lifecycle.addPrivateFeedback(scope, sessionId, {
        text: 'A replay must not overwrite the original.',
        textConsent: true,
      }),
    ).resolves.toMatchObject({ hasPrivateFeedback: true })
    expect((await stored()).text).toBe(
      'Late but still within the original recovery session.',
    )
    expect(await outbox.byTag('guest.feedback.submitted')).toHaveLength(1)
  })

  it('rejects feedback without the required private rating', async () => {
    const { scope, lifecycle, outbox } = await harness()

    await expect(
      lifecycle.submit(scope, sessionId, {
        text: 'The lobby coffee is excellent.',
        textConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'rating_required' })

    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(0)
    expect(await outbox.byTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('records nothing for a repeated submit of the same session', async () => {
    const { scope, lifecycle, outbox } = await harness()
    const input = { rating: 3, responseConsent: true }

    await lifecycle.submit(scope, sessionId, input)
    await lifecycle.submit(scope, sessionId, input)

    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
  })

  it('records a superseding fact for a corrected rating', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    await lifecycle.correct(scope, sessionId, { rating: 1 })

    expect(await outbox.byTag('guest.rating.submitted')).toMatchObject([
      { value: 3 },
      { value: 1, supersedesSourceEventId: original.eventId },
    ])
  })

  it('fails closed when historical shared content has no recoverable fact lineage', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    await db.execute(
      sql`UPDATE guest_responses SET rating_source_event_id = NULL WHERE organization_id = ${scope.organizationId}`,
    )

    await expect(
      lifecycle.correct(scope, sessionId, { rating: 1 }),
    ).rejects.toMatchObject({ code: 'response_unavailable' })
    await expect(lifecycle.withdraw(scope, sessionId)).rejects.toMatchObject({
      code: 'response_unavailable',
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('records a retraction for a withdrawn rating', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    await lifecycle.withdraw(scope, sessionId)

    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { ratingId: original.ratingId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('retracts private-feedback count independently during withdrawal', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const original = (await outbox.byTag('guest.feedback.submitted'))[0]!

    await lifecycle.withdraw(scope, sessionId)

    expect(await outbox.byTag('guest.feedback.retracted')).toMatchObject([
      { feedbackId: original.feedbackId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('withdraws private feedback without retracting the rating', async () => {
    const { scope, lifecycle, outbox, stored } = await harness()
    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const ratingFact = (await outbox.byTag('guest.rating.submitted'))[0]!
    const feedbackFact = (await outbox.byTag('guest.feedback.submitted'))[0]!

    const receipt = await lifecycle.withdrawPrivateFeedback(scope, sessionId)

    expect(receipt).toMatchObject({
      status: 'submitted',
      rating: 2,
      hasPrivateFeedback: false,
      privateFeedbackEligible: false,
      feedbackSubmittedAt: '2026-08-09T12:00:00.000Z',
      feedbackWithdrawnAt: '2026-08-09T12:00:00.000Z',
    })
    expect(await stored()).toMatchObject({
      rating: 2,
      text: null,
      feedbackSourceEventId: null,
    })
    expect(await outbox.byTag('guest.feedback.retracted')).toMatchObject([
      {
        feedbackId: feedbackFact.feedbackId,
        supersedesSourceEventId: feedbackFact.eventId,
      },
    ])
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    expect(await outbox.byTag('guest.rating.submitted')).toEqual([ratingFact])

    await expect(lifecycle.withdrawPrivateFeedback(scope, sessionId)).resolves.toEqual(
      receipt,
    )
    expect(await outbox.byTag('guest.feedback.retracted')).toHaveLength(1)
  })

  it('rejects private-feedback withdrawal after 24 hours without changing data', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored, keepSessionBound } = await harness(
      () => now,
    )
    await lifecycle.submit(scope, sessionId, { rating: 2, responseConsent: true })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    await keepSessionBound()
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(
      lifecycle.withdrawPrivateFeedback(scope, sessionId),
    ).rejects.toMatchObject({ code: 'feedback_withdrawal_expired' })
    expect(await stored()).toMatchObject({
      rating: 2,
      text: 'Please follow up.',
      feedbackWithdrawnAt: null,
    })
    expect(await outbox.byTag('guest.feedback.retracted')).toHaveLength(0)
  })

  it('rejects whole-response withdrawal after 24 hours without retracting rating', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored, keepSessionBound } = await harness(
      () => now,
    )
    await lifecycle.submit(scope, sessionId, { rating: 4, responseConsent: true })
    await keepSessionBound()
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(lifecycle.withdraw(scope, sessionId)).rejects.toMatchObject({
      code: 'response_withdrawal_expired',
    })
    expect(await stored()).toMatchObject({ status: 'submitted', rating: 4 })
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('uses the snapshotted inclusive threshold and never returns feedback text', async () => {
    const eligible = await harness()
    const low = await eligible.lifecycle.submit(
      eligible.scope,
      sessionId,
      { rating: 3, responseConsent: true },
      3,
    )
    expect(low.privateFeedbackEligible).toBe(true)
    const receipt = await eligible.lifecycle.addPrivateFeedback(
      eligible.scope,
      sessionId,
      {
        text: 'A private note for the manager.',
        textConsent: true,
      },
    )
    expect(receipt).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
    expect('text' in receipt).toBe(false)
    for (const internalField of [
      'id',
      'organizationId',
      'propertyId',
      'portalId',
      'sessionId',
      'category',
      'responseConsent',
      'textConsent',
      'mediaConsent',
    ]) {
      expect(receipt).not.toHaveProperty(internalField)
    }

    const ineligible = await harness()
    const high = await ineligible.lifecycle.submit(
      ineligible.scope,
      sessionId,
      { rating: 4, responseConsent: true },
      3,
    )
    expect(high.privateFeedbackEligible).toBe(false)
    await expect(
      ineligible.lifecycle.addPrivateFeedback(ineligible.scope, sessionId, {
        text: 'Not eligible',
        textConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'feedback_not_eligible' })
  })

  it.each([1, 2, 3, 4, 5])(
    'treats %i as inclusive for its captured threshold',
    async (threshold) => {
      const { scope, lifecycle } = await harness()
      const receipt = await lifecycle.submit(
        scope,
        sessionId,
        { rating: threshold, responseConsent: true },
        threshold,
      )
      expect(receipt.privateFeedbackEligible).toBe(true)
    },
  )

  it('unlocks feedback after a high-to-low correction without spending another correction', async () => {
    const { scope, lifecycle, stored, outbox } = await harness()
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true }, 3)
    const corrected = await lifecycle.correct(scope, sessionId, { rating: 2 })
    expect(corrected.privateFeedbackEligible).toBe(true)

    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Now eligible after correction.',
      textConsent: true,
    })
    expect(await stored()).toMatchObject({
      correctionCount: 1,
      rating: 2,
      text: 'Now eligible after correction.',
      feedbackSubmissionRevision: 2,
    })
    expect(await outbox.byTag('guest.feedback.submitted')).toMatchObject([
      { responseRevision: 2 },
    ])
  })
})

describe('isQualifiedGuestResponse', () => {
  // Keyed by every status, so a new status fails typecheck until it decides.
  const RATED_RESPONSE_QUALIFIES: Record<GuestResponseStatus, boolean> = {
    pending: true,
    submitted: true,
    corrected: true,
    moderated: true,
    expired: true,
    deleted: false,
  }
  const STATUSES = Object.keys(RATED_RESPONSE_QUALIFIES) as GuestResponseStatus[]

  function view(status: GuestResponseStatus, rating: number | null): GuestResponseView {
    return {
      status,
      rating,
      hasPrivateFeedback: false,
      privateFeedbackEligible: false,
      submittedAt: null,
      correctedAt: null,
      correctionDeadline: null,
      correctionAvailable: false,
      responseWithdrawalDeadline: null,
      responseWithdrawalAvailable: false,
      feedbackSubmittedAt: null,
      feedbackWithdrawalDeadline: null,
      feedbackWithdrawalAvailable: false,
      feedbackWithdrawnAt: null,
      deletedAt: null,
    }
  }

  it('denies a session that has no response', () => {
    expect(isQualifiedGuestResponse(null)).toBe(false)
  })

  it.each(STATUSES)('qualifies a rated %s response unless it was withdrawn', (status) => {
    expect(isQualifiedGuestResponse(view(status, 1))).toBe(
      RATED_RESPONSE_QUALIFIES[status],
    )
    expect(isQualifiedGuestResponse(view(status, 5))).toBe(
      RATED_RESPONSE_QUALIFIES[status],
    )
  })

  it.each(STATUSES)('denies an unrated %s response', (status) => {
    expect(isQualifiedGuestResponse(view(status, null))).toBe(false)
  })
})

describe('canStartNewGuestResponse', () => {
  const view = (
    status: GuestResponseStatus,
    rating: number | null,
  ): GuestResponseView => ({
    status,
    rating,
    hasPrivateFeedback: false,
    privateFeedbackEligible: false,
    submittedAt: null,
    correctedAt: null,
    correctionDeadline: null,
    correctionAvailable: false,
    responseWithdrawalDeadline: null,
    responseWithdrawalAvailable: false,
    feedbackSubmittedAt: null,
    feedbackWithdrawalDeadline: null,
    feedbackWithdrawalAvailable: false,
    feedbackWithdrawnAt: null,
    deletedAt: status === 'deleted' ? '2026-01-01T12:10:00.000Z' : null,
  })

  it('denies a session that has no response: there is nothing to start over from', () => {
    expect(canStartNewGuestResponse(null)).toBe(false)
  })

  it.each(['pending', 'submitted', 'corrected', 'moderated', 'expired'] as const)(
    'admits a rated %s response, as the shared-device case always did',
    (status) => {
      expect(canStartNewGuestResponse(view(status, 4))).toBe(true)
    },
  )

  it.each(['pending', 'submitted', 'corrected', 'moderated', 'expired'] as const)(
    'still denies an unrated %s response',
    (status) => {
      expect(canStartNewGuestResponse(view(status, null))).toBe(false)
    },
  )

  it('admits a response the guest withdrew, rated or not: its session can take no other', () => {
    expect(canStartNewGuestResponse(view('deleted', null))).toBe(true)
    expect(canStartNewGuestResponse(view('deleted', 2))).toBe(true)
  })

  it('widens nothing else: a withdrawn response still qualifies for no Google or link action', () => {
    expect(isQualifiedGuestResponse(view('deleted', null))).toBe(false)
    expect(isQualifiedGuestResponse(view('deleted', 2))).toBe(false)
  })
})

describe('operator erasure', () => {
  const sessionId = guestSessionId('00000000-0000-4000-8000-000000000003')
  const allow: OperatorErasureAuthority = { verify: async (id) => id === 'operator-1' }

  it('erases after the withdrawal window and retracts the readings', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const {
      scope,
      lifecycle,
      rawLifecycle,
      stored,
      outbox,
      keepSessionBound,
      journalWrites,
    } = await harness(() => now, allow)
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!
    await keepSessionBound()
    now = new Date('2026-08-12T12:00:00.000Z')
    await expect(lifecycle.withdraw(scope, sessionId)).rejects.toMatchObject({
      code: 'response_withdrawal_expired',
    })

    await expect(
      rawLifecycle.eraseAsOperator('operator-1', scope, (await stored()).id),
    ).resolves.toBe('erased')

    expect(await stored()).toMatchObject({ status: 'deleted', rating: null })
    expect(journalWrites).toHaveLength(1)
    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { supersedesSourceEventId: original.eventId },
    ])
  })

  it.each([undefined, allow])(
    'writes nothing for a denied operator',
    async (authority) => {
      const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
        undefined,
        authority,
      )
      await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })

      await expect(
        rawLifecycle.eraseAsOperator('someone-else', scope, (await stored()).id),
      ).rejects.toMatchObject({ code: 'operator_not_authorized' })

      expect(await stored()).toMatchObject({ status: 'submitted', rating: 3 })
      expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    },
  )

  it('writes nothing for a subject outside the tenant scope', async () => {
    const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
      undefined,
      allow,
    )
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })

    await expect(
      rawLifecycle.eraseAsOperator(
        'operator-1',
        { ...scope, organizationId: organizationId('other-org') },
        (await stored()).id,
      ),
    ).rejects.toMatchObject({ code: 'response_not_found' })

    expect(await stored()).toMatchObject({ status: 'submitted' })
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('is idempotent for an already erased response', async () => {
    const { scope, lifecycle, rawLifecycle, stored, outbox } = await harness(
      undefined,
      allow,
    )
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const id = (await stored()).id
    await rawLifecycle.eraseAsOperator('operator-1', scope, id)

    await expect(rawLifecycle.eraseAsOperator('operator-1', scope, id)).resolves.toBe(
      'already_erased',
    )
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(1)
  })
})
