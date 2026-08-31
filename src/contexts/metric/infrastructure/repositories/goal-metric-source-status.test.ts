import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import type { GoalMetricAggregateQuery } from '../../application/ports/metric.repository'
import { createGoalMetricSourceStatus } from './goal-metric-source-status'

const db = getDb()
const ORG = organizationId('org-goal-source-status')
const PROPERTY = propertyId('62000000-0000-4000-8000-000000000001')
const PORTAL = portalId('62000000-0000-4000-8000-000000000002')
const GROUP = portalGroupId('62000000-0000-4000-8000-000000000003')
const VERSION = '11111111-1111-4111-8111-111111111302'
const QUALIFIED_SCAN_VERSION = '11111111-1111-4111-8111-111111111301'
const SUBMITTED_EVENT = '62000000-0000-4000-8000-000000000004'
const RETRACTED_EVENT = '62000000-0000-4000-8000-000000000005'
const READING = '62000000-0000-4000-8000-000000000006'
const OLD_READING = '62000000-0000-4000-8000-000000000009'
const OLD_SOURCE = '62000000-0000-4000-8000-000000000099'
const START = new Date('2026-06-01T00:00:00.000Z')
const END = new Date('2026-07-01T00:00:00.000Z')
const OCCURRED = new Date('2026-06-15T12:00:00.000Z')

const portalGroups: PortalGroupPublicApi = {
  findGroupForPortal: async (orgId, pid, asOf) =>
    orgId === ORG && pid === PORTAL && asOf && asOf >= START && asOf < END
      ? { id: GROUP, propertyId: PROPERTY, name: 'Front Desk' }
      : null,
  getGroupPortalIds: async () => [PORTAL],
  findGroupIdsByPortalIds: async () => [GROUP],
  portalGroupBelongsToProperty: async () => true,
}

const query = (
  subject: GoalMetricAggregateQuery['subject'],
): GoalMetricAggregateQuery => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  definitionVersionId: VERSION,
  expectedMetricKey: 'portal.rating_count',
  allowedSourcePolicies: ['first_party_guest_gateway_metric'],
  subject,
  periodStart: START,
  periodEnd: END,
})

async function insertSource(eventId: string, eventType: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id, created_at, published_at
    ) VALUES (
      ${eventId}::uuid, ${eventType}, 1,
      ${JSON.stringify({
        ratingId: READING,
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        ...(eventType.endsWith('.submitted') ? { value: 4 } : {}),
        ...(eventType.endsWith('.retracted')
          ? { supersedesSourceEventId: SUBMITTED_EVENT }
          : {}),
        occurredAt: OCCURRED.toISOString(),
      })}::jsonb,
      ${ORG}, ${PROPERTY}, 'guest', ${READING}, ${OCCURRED}, ${OCCURRED}
    )
  `)
}

async function receipt(eventId: string, status = 'applied'): Promise<void> {
  await db.execute(sql`
    INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
    VALUES (${eventId}::uuid, 'metric.guest-analytics', ${status})
  `)
}

async function insertReading(groupId: string | null = GROUP): Promise<void> {
  await db.execute(sql`
    INSERT INTO metric_readings (
      id, organization_id, property_id, portal_id, group_id, metric_key,
      value, recorded_at, definition_version_id, source_event_id, source_policy,
      exact_value, sample_count, attribution_quality, event_at,
      property_local_date, data_quality, retention_class
    ) VALUES (
      ${READING}::uuid, ${ORG}, ${PROPERTY}::uuid, ${PORTAL}::uuid,
      ${groupId}::uuid, 'portal.rating_count', 1, ${OCCURRED}, ${VERSION}::uuid,
      ${SUBMITTED_EVENT}, 'first_party_guest_gateway_metric', 1, 1, 'exact',
      ${OCCURRED}, '2026-06-15', 'exact', 'guest_gateway_24_month'
    )
  `)
}

async function insertPriorReading(): Promise<void> {
  await db.execute(sql`
    INSERT INTO metric_readings (
      id, organization_id, property_id, portal_id, group_id, metric_key,
      value, recorded_at, definition_version_id, source_event_id, source_policy,
      exact_value, sample_count, attribution_quality, event_at,
      property_local_date, data_quality, retention_class
    ) VALUES (
      ${OLD_READING}::uuid, ${ORG}, ${PROPERTY}::uuid, ${PORTAL}::uuid,
      ${GROUP}::uuid, 'portal.rating_count', 1, ${START}, ${VERSION}::uuid,
      ${OLD_SOURCE}, 'first_party_guest_gateway_metric', 1, 1, 'exact',
      ${START}, '2026-06-01', 'exact', 'guest_gateway_24_month'
    )
  `)
}

async function clean(): Promise<void> {
  await db.execute(sql`
    DELETE FROM metric_corrections
    WHERE reading_id IN (
      SELECT id FROM metric_readings WHERE organization_id = ${ORG}
    )
  `)
  await db.execute(sql`
    DELETE FROM metric_quarantine WHERE organization_id = ${ORG}
  `)
  await db.execute(sql`
    DELETE FROM metric_readings WHERE organization_id = ${ORG}
  `)
  await db.execute(sql`
    DELETE FROM outbox_events WHERE organization_id = ${ORG}
  `)
}

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Goal Source Status', ${ORG}, now())
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROPERTY}, ${ORG}, 'Source Status Property', 'source-status-property', 'UTC')
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${PORTAL}, ${ORG}, ${PROPERTY}, 'property', ${PROPERTY},
      'Source Status Portal', 'source-status-portal', 'published'
    ) ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO portal_groups (id, organization_id, property_id, name)
    VALUES (${GROUP}, ${ORG}, ${PROPERTY}, 'Front Desk')
    ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  await db.execute(sql`DELETE FROM portal_groups WHERE id = ${GROUP}`)
  await db.execute(sql`DELETE FROM portals WHERE id = ${PORTAL}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}`)
  await deleteTestOrganizations(db, [ORG])
})

describe.sequential('Goal metric durable source status (integration)', () => {
  it('treats an empty source period as complete, not as an implicit reading', async () => {
    const status = createGoalMetricSourceStatus(db, portalGroups)
    await expect(
      status.inspect(query({ kind: 'property', propertyId: PROPERTY }), [
        'guest.rating.submitted',
        'guest.rating.retracted',
      ]),
    ).resolves.toEqual({
      state: 'complete',
      relevantFactCount: 0,
      pendingFactCount: 0,
      reason: null,
    })
  })

  it('requires a durable receipt and the exact subject attribution', async () => {
    const status = createGoalMetricSourceStatus(db, portalGroups)
    await insertSource(SUBMITTED_EVENT, 'guest.rating.submitted')

    await expect(
      status.inspect(query({ kind: 'portal', portalId: PORTAL }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'pending', pendingFactCount: 1 })

    await receipt(SUBMITTED_EVENT, 'obsolete')
    await expect(
      status.inspect(query({ kind: 'portal', portalId: PORTAL }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'source_fact_obsolete' })
    await db.execute(sql`
      UPDATE event_consumer_receipts SET status = 'applied'
      WHERE event_id = ${SUBMITTED_EVENT}::uuid
        AND consumer_name = 'metric.guest-analytics'
    `)
    await db.execute(sql`
      INSERT INTO metric_quarantine (
        source_event_id, organization_id, property_id, definition_version_id,
        source_policy, reason, payload_hash, event_at
      ) VALUES (
        ${SUBMITTED_EVENT}, ${ORG}, ${PROPERTY}::uuid, ${VERSION}::uuid,
        'first_party_guest_gateway_metric', 'test_quarantine', ${'0'.repeat(64)},
        ${OCCURRED}
      )
    `)
    await expect(
      status.inspect(query({ kind: 'portal', portalId: PORTAL }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'quarantined', reason: 'source_fact_quarantined' })
    await db.execute(sql`
      DELETE FROM metric_quarantine WHERE organization_id = ${ORG}
    `)
    await insertReading()
    await expect(
      status.inspect(query({ kind: 'portal_group', portalGroupId: GROUP }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'complete', relevantFactCount: 1 })

    await db.execute(sql`
      UPDATE outbox_events
      SET payload = payload || ${JSON.stringify({
        supersedesSourceEventId: OLD_SOURCE,
      })}::jsonb
      WHERE id = ${SUBMITTED_EVENT}::uuid
    `)
    await expect(
      status.inspect(query({ kind: 'portal_group', portalGroupId: GROUP }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'quarantined', reason: 'correction_missing' })
    await insertPriorReading()
    await db.execute(sql`
      INSERT INTO metric_corrections (
        id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
        event_at
      ) VALUES (
        '62000000-0000-4000-8000-000000000008', ${OLD_READING}::uuid,
        ${`${SUBMITTED_EVENT}:retract`}, 'retract', 'source_reconciliation',
        'system', 'guest.gateway', ${OCCURRED}
      )
    `)
    await expect(
      status.inspect(query({ kind: 'portal_group', portalGroupId: GROUP }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({ state: 'complete', relevantFactCount: 1 })

    await db.execute(sql`
      UPDATE metric_readings SET group_id = NULL WHERE id = ${READING}::uuid
    `)
    await expect(
      status.inspect(query({ kind: 'portal_group', portalGroupId: GROUP }), [
        'guest.rating.submitted',
      ]),
    ).resolves.toMatchObject({
      state: 'quarantined',
      reason: 'group_attribution_mismatch',
    })
  })

  it('requires an applied retraction to have its append-only correction', async () => {
    const status = createGoalMetricSourceStatus(db, portalGroups)
    await insertSource(SUBMITTED_EVENT, 'guest.rating.submitted')
    await receipt(SUBMITTED_EVENT)
    await insertReading()
    await insertSource(RETRACTED_EVENT, 'guest.rating.retracted')
    await receipt(RETRACTED_EVENT)

    await expect(
      status.inspect(query({ kind: 'property', propertyId: PROPERTY }), [
        'guest.rating.submitted',
        'guest.rating.retracted',
      ]),
    ).resolves.toMatchObject({ state: 'quarantined', reason: 'projection_missing' })

    await db.execute(sql`
      INSERT INTO metric_corrections (
        id, reading_id, source_event_id, kind, reason, actor_type, actor_id,
        event_at
      ) VALUES (
        '62000000-0000-4000-8000-000000000007', ${READING}::uuid,
        ${`${RETRACTED_EVENT}:${VERSION}`}, 'retract', 'guest_fact_retracted',
        'system', 'guest.gateway', ${OCCURRED}
      )
    `)
    await expect(
      status.inspect(query({ kind: 'property', propertyId: PROPERTY }), [
        'guest.rating.submitted',
        'guest.rating.retracted',
      ]),
    ).resolves.toMatchObject({ state: 'complete', relevantFactCount: 2 })
  })

  it('uses Qualified Scan captured group attribution instead of current membership', async () => {
    const status = createGoalMetricSourceStatus(db, {
      ...portalGroups,
      findGroupForPortal: async () => {
        throw new Error('current membership must not reinterpret Qualified Scan facts')
      },
    })
    await insertSource(SUBMITTED_EVENT, 'guest.qualified_scan.recorded')
    await db.execute(sql`
      UPDATE outbox_events
      SET payload = payload || ${JSON.stringify({ portalGroupId: GROUP })}::jsonb
      WHERE id = ${SUBMITTED_EVENT}::uuid
    `)
    await receipt(SUBMITTED_EVENT)
    await insertReading()
    await db.execute(sql`
      UPDATE metric_readings
      SET definition_version_id = ${QUALIFIED_SCAN_VERSION}::uuid,
          metric_key = 'portal.qualified_scan'
      WHERE id = ${READING}::uuid
    `)

    await expect(
      status.inspect(
        {
          ...query({ kind: 'portal_group', portalGroupId: GROUP }),
          definitionVersionId: QUALIFIED_SCAN_VERSION,
          expectedMetricKey: 'portal.qualified_scan',
        },
        ['guest.qualified_scan.recorded', 'guest.qualified_scan.retracted'],
      ),
    ).resolves.toMatchObject({ state: 'complete', relevantFactCount: 1 })
  })
})
