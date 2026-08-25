import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  ratingId,
} from '#/shared/domain/ids'
import { guestFeedbackSubmitted, guestRatingSubmitted } from '../../domain/events'
import type { GuestResponse } from '../../domain/guest-response'
import type { GuestSubmissionFact } from '../../application/ports/guest-response-command-store.port'
import { createAtomicGuestResponseCommandStore } from '../guest-response-command-store'

const db = getDb()
const ORG = organizationId('org-guest-response-command-store')
const PROPERTY = propertyId('51000000-0000-4000-8000-000000000001')
const PORTAL = portalId('51000000-0000-4000-8000-000000000002')
const RESPONSE = '51000000-0000-4000-8000-000000000003'
const SESSION = '51000000-0000-4000-8000-000000000004'
const NOW = new Date('2026-08-25T12:00:00.000Z')

function response(): GuestResponse {
  return {
    id: RESPONSE,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    sessionId: SESSION,
    status: 'submitted',
    rating: 2,
    category: null,
    text: 'Please contact the front desk.',
    responseConsent: true,
    textConsent: true,
    mediaConsent: false,
    contactConsent: false,
    contactDetails: null,
    correctionCount: 0,
    submittedAt: NOW,
    correctedAt: null,
    moderatedAt: null,
    deletedAt: null,
    retentionDeadline: new Date('2026-11-23T12:00:00.000Z'),
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
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM guest_responses WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  clearEventSchemas()
})

describe.sequential('atomic Guest response submission', () => {
  it('commits the response and both content-free facts together', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestResponseCommandStore(db, events)
    const submissionFacts = facts()

    await expect(store.commitSubmitted(response(), submissionFacts)).resolves.toBe(
      'applied',
    )

    const rows = await db.execute(sql`
      SELECT id FROM guest_responses WHERE organization_id = ${ORG}
    `)
    const outbox = await db.execute(sql`
      SELECT event_type FROM outbox_events
      WHERE organization_id = ${ORG}
      ORDER BY event_type
    `)
    expect(rows.rows).toHaveLength(1)
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
})
