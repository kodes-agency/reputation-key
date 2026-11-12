import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { trackReviewLinkClick } from './track-review-link-click'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId, portalLinkId } from '#/shared/domain/ids'
import type { GuestObservationStore } from '../ports/guest-observation-store.port'
import { createAtomicGuestObservationStore } from '../../infrastructure/guest-observation-store'

const db = getDb()
const SESSION_EXPIRES_AT = new Date('2026-05-02T12:00:00Z')
const NOW = new Date('2026-05-01T12:00:00Z')
const ORG = `org-review-link-click-${randomUUID()}`
const PROPERTY = randomUUID()
const PORTAL = randomUUID()

const guestAction = (linkId: string, sessionId: string) => ({
  linkId: portalLinkId(linkId),
  sessionId,
  sessionExpiresAt: SESSION_EXPIRES_AT,
  organizationId: organizationId(ORG),
  portalId: portalId(PORTAL),
  propertyId: propertyId(PROPERTY),
})

async function clickFacts() {
  const rows = await db.execute(sql`
    SELECT payload FROM outbox_events
    WHERE organization_id = ${ORG} AND event_type = 'guest.review_link.clicked'
    ORDER BY created_at, id
  `)
  return rows.rows.map((row) => row.payload)
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Review Link Click', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Review Link Property', ${PROPERTY}, 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Review Link Portal', ${PORTAL}, 'published'
    )
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`
    DELETE FROM idempotency_receipts
    WHERE scope = 'guest_destination_action' AND key LIKE ${`%${ORG}%`}
  `)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe('trackReviewLinkClick', () => {
  const track = () =>
    trackReviewLinkClick({
      observationStore: createAtomicGuestObservationStore(db),
      clock: () => NOW,
      reportObservationLoss: vi.fn(async () => 'recorded' as const),
    })

  it('commits the durable destination fact through the observation store', async () => {
    await track()(guestAction('link-123', randomUUID()))

    expect(await clickFacts()).toMatchObject([{ destinationKind: 'secondary_link' }])
  })

  it('preserves Google selections as a distinct durable destination fact', async () => {
    await track()({
      ...guestAction('google-review', randomUUID()),
      destinationKind: 'google_review',
    })

    expect(await clickFacts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destinationKind: 'google_review' }),
      ]),
    )
  })

  it('keeps approved navigation available when observation persistence fails', async () => {
    const unavailable: GuestObservationStore = {
      commitQualifiedScan: async () => 'applied',
      retractQualifiedScan: async () => 'applied',
      commitScan: async () => 'applied',
      commitReviewLinkClick: async () => {
        throw new Error('observation unavailable')
      },
    }
    const reportObservationLoss = vi.fn(async () => 'recorded' as const)
    const useCase = trackReviewLinkClick({
      observationStore: unavailable,
      clock: () => NOW,
      reportObservationLoss,
    })

    await expect(useCase(guestAction('link-123', randomUUID()))).resolves.toBeUndefined()
    expect(reportObservationLoss).toHaveBeenCalledOnce()
    expect(reportObservationLoss).toHaveBeenCalledWith('review_link')
  })
})
