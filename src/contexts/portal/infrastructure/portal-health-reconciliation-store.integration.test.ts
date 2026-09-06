import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { portalHealthIntervals } from '#/shared/db/schema/portal.schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId } from '#/shared/domain/ids'
import { createPortalHealthReconciliationStore } from './portal-health-reconciliation-store'

const ORG = organizationId('portal-health-reconcile-org')
const OTHER_ORG = organizationId('portal-health-reconcile-other-org')
const PROPERTY = '89000000-0000-4000-8000-000000000001'
const PORTAL = '89000000-0000-4000-8000-000000000002'
const SOURCE_EVENT = '89000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-08-27T08:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'portal_health_intervals',
    'portal_responsible_managers',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_tokens',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, lifecycle_state, created_at, updated_at)
     VALUES ($1, $2, 'Health Property', 'health-property', 'UTC', 'active', $3, $3)`,
    [PROPERTY, ORG, NOW],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        theme, private_feedback_threshold, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Lobby', 'lobby', '{}'::jsonb, 3,
             'draft', $4, $4)`,
    [PORTAL, ORG, PROPERTY, NOW],
  )
  await getPool().query(
    `INSERT INTO portal_health_intervals
       (id, organization_id, property_id, portal_id, status, reason,
        source_version, effective_from, observed_at)
     VALUES ('89000000-0000-4000-8000-000000000004', $1, $2, $3,
             'healthy', 'operational', 'legacy', $4, $4)`,
    [ORG, PROPERTY, PORTAL, NOW],
  )
  await getDb()
    .insert(outboxEvents)
    .values({
      id: SOURCE_EVENT,
      eventType: 'property.updated',
      eventVersion: 1,
      payload: { organizationId: ORG, propertyId: PROPERTY },
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'property',
      sourceAggregateId: PROPERTY,
      createdAt: NOW,
      publishedAt: NOW,
    })
})

describe.sequential('Portal Health reconciliation store (real PostgreSQL)', () => {
  it('atomically changes the interval, records one fact and settles replay once', async () => {
    const store = createPortalHealthReconciliationStore(getDb(), {
      clock: () => new Date(NOW.getTime() + 1_000),
      idGen: () => '89000000-0000-4000-8000-000000000005',
    })
    const input = {
      eventId: SOURCE_EVENT,
      consumerName: 'portal.reconcile-health-dependencies',
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: null,
      sourceVersion: `${SOURCE_EVENT}:property`,
      occurredAt: new Date(NOW.getTime() + 1_000),
    } as const

    await expect(store.reconcile(input)).resolves.toEqual({
      status: 'applied',
      changed: 1,
    })
    await expect(store.reconcile(input)).resolves.toEqual({
      status: 'duplicate',
      changed: 0,
    })

    const history = await getDb()
      .select()
      .from(portalHealthIntervals)
      .where(eq(portalHealthIntervals.portalId, PORTAL))
    expect(history).toHaveLength(2)
    expect(history.find((row) => row.effectiveTo === null)).toMatchObject({
      status: 'unavailable',
      reason: 'publication_draft',
      sourceVersion: `${SOURCE_EVENT}:property`,
    })
    const facts = await getDb()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORG),
          eq(outboxEvents.eventType, 'portal.health.changed'),
        ),
      )
    expect(facts).toHaveLength(1)
    expect(facts[0]!.payload).toMatchObject({
      portalId: PORTAL,
      previousStatus: 'healthy',
      previousReason: 'operational',
      status: 'unavailable',
      reason: 'publication_draft',
    })
    const receipts = await getDb()
      .select()
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, SOURCE_EVENT))
    expect(receipts).toHaveLength(1)
  })
})
