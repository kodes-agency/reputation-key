import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
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
import { createAtomicGuestObservationStore } from '../guest-observation-store'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'

const db = getDb()
const ORG = organizationId('org-guest-observation-store')
const PROPERTY = propertyId('52000000-0000-4000-8000-000000000001')
const PORTAL = portalId('52000000-0000-4000-8000-000000000002')
const SESSION = 'guest-observation-session'
const NOW = new Date('2026-08-25T12:00:00.000Z')

function scan(index: number): ScanEvent {
  return {
    id: scanEventId(`52000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    source: 'qr',
    sessionId: SESSION,
    ipHash: 'rotating-abuse-pseudonym',
    createdAt: NOW,
  }
}

function scanFact(value: ScanEvent): GuestScanRecorded {
  return guestScanRecorded({
    scanId: value.id,
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    source: value.source,
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
  await db.execute(sql`DELETE FROM scan_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM scan_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM portals WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  clearEventSchemas()
})

describe.sequential('atomic Guest observations', () => {
  it('refuses to insert an observation whose short-lived pseudonyms were scrubbed', async () => {
    const store = createAtomicGuestObservationStore(db, createCapturingEventBus())
    const candidate = { ...scan(99), sessionId: null, ipHash: null }

    await expect(store.commitScan(candidate, scanFact(candidate))).rejects.toThrow(
      'new guest observations require live pseudonyms',
    )
  })

  it('serializes concurrent scans to one source row and one fact', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestObservationStore(db, events)
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
    expect(events.capturedByTag('guest.scan.recorded')).toHaveLength(1)
  })

  it('independently scrubs session and network pseudonyms without deleting the visit fact', async () => {
    const store = createAtomicGuestObservationStore(db, createCapturingEventBus())
    const candidate = scan(10)
    await expect(store.commitScan(candidate, scanFact(candidate))).resolves.toBe(
      'applied',
    )

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
    const store = createAtomicGuestObservationStore(db, createCapturingEventBus())
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

  it('commits a link-action fact before emitting the fast path', async () => {
    const events = createCapturingEventBus()
    const store = createAtomicGuestObservationStore(db, events)
    const fact = guestReviewLinkClicked({
      linkId: portalLinkId('52000000-0000-4000-8000-000000000030'),
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      occurredAt: NOW,
    })

    await expect(store.commitReviewLinkClick(fact)).resolves.toBe('applied')

    const outbox = await db.execute(sql`
      SELECT id FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'guest.review_link.clicked'
    `)
    expect(outbox.rows).toHaveLength(1)
    expect(events.capturedByTag('guest.review_link.clicked')).toHaveLength(1)
  })
})
