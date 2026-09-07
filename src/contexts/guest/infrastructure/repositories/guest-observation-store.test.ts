import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  organizationId,
  portalId,
  portalLinkId,
  propertyId,
  scanEventId,
} from '#/shared/domain/ids'
import { guestReviewLinkClicked, guestScanRecorded } from '../../domain/events'
import type { ScanEvent } from '../../domain/types'
import type { GuestScanRecorded } from '../../domain/events'
import type { GuestReviewLinkClicked } from '../../domain/events'
import { createAtomicGuestObservationStore } from '../guest-observation-store'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'

const db = getDb()
const ORG = organizationId('org-guest-observation-store')
const PROPERTY = propertyId('52000000-0000-4000-8000-000000000001')
const PORTAL = portalId('52000000-0000-4000-8000-000000000002')
const SESSION = 'guest-observation-session'
const ACTION_SESSION = '52000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-08-25T12:00:00.000Z')

function scan(index: number): ScanEvent {
  return {
    id: scanEventId(`52000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    source: 'qr',
    sessionId: SESSION,
    ipHash: null,
    createdAt: NOW,
  }
}

function scanFact(value: ScanEvent): GuestScanRecorded {
  return guestScanRecorded({
    scanId: value.id,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    scanSource: value.source,
    occurredAt: NOW,
  })
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Guest Observation Store', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Guest Observation Property', 'guest-observation-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Guest Observation Portal', 'guest-observation-portal', 'published'
    ) ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`
    DELETE FROM idempotency_receipts
    WHERE scope = 'guest_destination_action' AND payload->>'organizationId' = ${ORG}
  `)
  await db.execute(sql`DELETE FROM scan_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
})

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM idempotency_receipts
    WHERE scope = 'guest_destination_action' AND payload->>'organizationId' = ${ORG}
  `)
  await db.execute(sql`DELETE FROM scan_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe.sequential('atomic Guest observations', () => {
  it('requires the signed-session pseudonym but keeps the diagnostic fact free of a network copy', async () => {
    const store = createAtomicGuestObservationStore(db)
    const candidate = { ...scan(99), sessionId: null, ipHash: null }

    await expect(store.commitScan(candidate, scanFact(candidate))).rejects.toThrow(
      'new guest observations require a live session pseudonym',
    )

    const contentFree = scan(98)
    await expect(store.commitScan(contentFree, scanFact(contentFree))).resolves.toBe(
      'applied',
    )
    await expect(
      db.execute(sql`
        SELECT ip_hash FROM scan_events
        WHERE organization_id = ${ORG} AND id = ${contentFree.id}
      `),
    ).resolves.toMatchObject({ rows: [{ ip_hash: null }] })
  })

  it('serializes concurrent scans to one source row and one fact', async () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#1
    const store = createAtomicGuestObservationStore(db)
    const candidates = Array.from({ length: 8 }, (_, index) => scan(index + 1))

    const outcomes = await Promise.all(
      candidates.map((candidate) => store.commitScan(candidate, scanFact(candidate))),
    )

    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(7)
    const scans = await db.execute(sql`
      SELECT id FROM scan_events WHERE organization_id = ${ORG}
    `)
    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.scan.recorded'
    `)
    expect(scans.rows).toHaveLength(1)
    expect(outbox.rows).toHaveLength(1)
  })

  it('independently scrubs session and network pseudonyms without deleting the visit fact', async () => {
    const store = createAtomicGuestObservationStore(db)
    const candidate = { ...scan(10), ipHash: 'rotating-abuse-pseudonym' }
    await expect(store.commitScan(candidate, scanFact(candidate))).resolves.toBe(
      'applied',
    )
    // Canonical writes force this compatibility column null. Recreate a stale
    // pre-0142/restore value solely to prove the defensive legacy sweep.
    await db.execute(sql`
      UPDATE scan_events
      SET ip_hash = 'rotating-abuse-pseudonym'
      WHERE organization_id = ${ORG}
    `)

    const sessionRule = RETENTION_RULES.find(
      (rule) => rule.subject === 'scan_events.guest_session_pseudonym',
    )!
    const abuseRule = RETENTION_RULES.find(
      (rule) => rule.subject === 'scan_events.abuse_pseudonym',
    )!
    const eligibleCutoff = new Date(NOW.getTime() + 1)

    await expect(
      executeRetentionRule(db, sessionRule, {
        cutoff: eligibleCutoff,
        batchSize: 10,
      }),
    ).resolves.toMatchObject({ rowsDeleted: 0, rowsRedacted: 1 })
    let retained = await db.execute(sql`
      SELECT session_id, ip_hash FROM scan_events WHERE organization_id = ${ORG}
    `)
    expect(retained.rows).toEqual([
      { session_id: null, ip_hash: 'rotating-abuse-pseudonym' },
    ])

    await expect(
      executeRetentionRule(db, abuseRule, {
        cutoff: eligibleCutoff,
        batchSize: 10,
      }),
    ).resolves.toMatchObject({ rowsDeleted: 0, rowsRedacted: 1 })
    retained = await db.execute(sql`
      SELECT session_id, ip_hash FROM scan_events WHERE organization_id = ${ORG}
    `)
    expect(retained.rows).toEqual([{ session_id: null, ip_hash: null }])

    const facts = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.scan.recorded'
    `)
    expect(facts.rows).toHaveLength(1)
  })

  it('rolls back the scan row when its fact is invalid', async () => {
    const store = createAtomicGuestObservationStore(db)
    const candidate = scan(20)
    const invalid = {
      ...scanFact(candidate),
      _tag: 'guest.scan.unregistered',
    } as unknown as GuestScanRecorded

    await expect(store.commitScan(candidate, invalid)).rejects.toThrow(
      'is not registered for the outbox',
    )

    const scans = await db.execute(sql`
      SELECT id FROM scan_events WHERE organization_id = ${ORG}
    `)
    expect(scans.rows).toHaveLength(0)
  })

  it('serializes a session/destination action to one receipt and one fact', async () => {
    // @proof PUBLIC_REDIRECT_AND_ABUSE#2
    const store = createAtomicGuestObservationStore(db)
    const fact = guestReviewLinkClicked({
      linkId: portalLinkId('52000000-0000-4000-8000-000000000030'),
      destinationKind: 'secondary_link',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: NOW,
    })

    const action = {
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      sessionId: ACTION_SESSION,
      destinationId: fact.linkId,
      destinationKind: fact.destinationKind,
      occurredAt: NOW,
      expiresAt: new Date('2026-08-26T12:00:00.000Z'),
    } as const

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => store.commitReviewLinkClick(action, fact)),
    )

    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(7)

    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.review_link.clicked'
    `)
    const receipts = await db.execute(sql`
      SELECT key FROM idempotency_receipts
      WHERE scope = 'guest_destination_action' AND payload->>'organizationId' = ${ORG}
    `)
    expect(outbox.rows).toHaveLength(1)
    expect(receipts.rows).toHaveLength(1)
  })

  it('sweeps the shared receipt after its 30-day retention window', async () => {
    const store = createAtomicGuestObservationStore(db)
    const fact = guestReviewLinkClicked({
      linkId: portalLinkId('52000000-0000-4000-8000-000000000031'),
      destinationKind: 'google_review',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: NOW,
    })
    await store.commitReviewLinkClick(
      {
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        sessionId: ACTION_SESSION,
        destinationId: fact.linkId,
        destinationKind: fact.destinationKind,
        occurredAt: NOW,
        expiresAt: new Date('2026-08-26T12:00:00.000Z'),
      },
      fact,
    )
    const rule = RETENTION_RULES.find(
      (candidate) => candidate.subject === 'idempotency_receipts',
    )!

    await executeRetentionRule(db, rule, {
      cutoff: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000 + 1),
      batchSize: 10,
    })
    const receipts = await db.execute(sql`
      SELECT key FROM idempotency_receipts
      WHERE scope = 'guest_destination_action'
        AND payload->>'organizationId' = ${ORG}
        AND payload->>'destinationId' = ${fact.linkId}
    `)
    expect(receipts.rows).toEqual([])

    const facts = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.review_link.clicked'
    `)
    expect(facts.rows).toHaveLength(1)
  })

  it('rolls back the action receipt when its durable fact is invalid', async () => {
    const store = createAtomicGuestObservationStore(db)
    const valid = guestReviewLinkClicked({
      linkId: portalLinkId('52000000-0000-4000-8000-000000000032'),
      destinationKind: 'secondary_link',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: NOW,
    })
    const invalid = {
      ...valid,
      _tag: 'guest.destination.unregistered',
    } as unknown as GuestReviewLinkClicked

    await expect(
      store.commitReviewLinkClick(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          portalId: PORTAL,
          sessionId: ACTION_SESSION,
          destinationId: valid.linkId,
          destinationKind: valid.destinationKind,
          occurredAt: NOW,
          expiresAt: new Date('2026-08-26T12:00:00.000Z'),
        },
        invalid,
      ),
    ).rejects.toThrow('is not registered for the outbox')

    const receipts = await db.execute(sql`
      SELECT key FROM idempotency_receipts
      WHERE scope = 'guest_destination_action' AND payload->>'organizationId' = ${ORG}
    `)
    expect(receipts.rows).toHaveLength(0)
  })
})
