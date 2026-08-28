import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { propertyArchived } from '../domain/events'
import { createPropertyLifecycleCommandStore } from './property-lifecycle-command-store'

const db = getDb()
const ORGANIZATION_ID = organizationId('org-property-lifecycle-atomicity')
const PROPERTY_ID = propertyId('f5000000-0000-4000-8000-000000000001')
const ACTOR_ID = userId('admin-property-lifecycle')
const NOW = new Date('2026-08-28T12:00:00.000Z')
const RECOVERY_DEADLINE = new Date('2026-09-27T12:00:00.000Z')

const events: EventBus = {
  on: vi.fn(),
  clear: vi.fn(),
  emit: vi.fn(),
}

const archiveEvent = () =>
  propertyArchived({
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    userId: ACTOR_ID,
    previousState: 'active',
    sourceEpoch: 8,
    recoveryDeadline: RECOVERY_DEADLINE,
    occurredAt: NOW,
  })

const archiveCommand = (event: ReturnType<typeof archiveEvent>) => ({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  from: 'active' as const,
  to: 'archived' as const,
  expectedSourceEpoch: 7,
  nextSourceEpoch: 8,
  expectedProfileVersion: 1,
  reason: 'Property no longer trading',
  recoveryDeadline: RECOVERY_DEADLINE,
  initiatedBy: ACTOR_ID,
  occurredAt: NOW,
  event,
})

async function resetProperty() {
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
  )
  await db.execute(sql`
    UPDATE properties
    SET lifecycle_state = 'active',
        lifecycle_reason = NULL,
        lifecycle_state_changed_at = ${NOW},
        purge_scheduled_for = NULL,
        lifecycle_initiated_by = NULL,
        source_epoch = 7,
        google_review_destination_state = 'unavailable',
        google_review_uri = NULL,
        google_review_destination_retrieved_at = NULL,
        google_review_destination_source_epoch = NULL,
        google_review_destination_profile_version = NULL,
        updated_at = ${NOW}
    WHERE id = ${PROPERTY_ID}
  `)
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (
      ${ORGANIZATION_ID},
      'Property Lifecycle Atomicity',
      ${ORGANIZATION_ID},
      ${NOW}
    )
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, processing_region, data_cell_id,
      processing_region_source, processing_region_resolved_at, source_epoch,
      created_at, updated_at
    ) VALUES (
      ${PROPERTY_ID}, ${ORGANIZATION_ID}, 'Lifecycle Property',
      'property-lifecycle-atomicity', 'UTC', 'us', 'us', 'country_policy',
      ${NOW}, 7, ${NOW}, ${NOW}
    )
    ON CONFLICT (id) DO NOTHING
  `)
})

beforeEach(async () => {
  vi.clearAllMocks()
  await resetProperty()
})

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
})

describe('Property lifecycle command store atomicity', () => {
  it('preserves one stable row while co-committing archive and its durable fact', async () => {
    const event = archiveEvent()

    await createPropertyLifecycleCommandStore(db, events, 'us').transitionLifecycle(
      archiveCommand(event),
    )

    const result = await db.execute(sql`
      SELECT
        p.lifecycle_state,
        p.lifecycle_reason,
        p.purge_scheduled_for,
        p.source_epoch,
        p.deleted_at,
        count(o.id)::int AS fact_count
      FROM properties p
      LEFT JOIN outbox_events o
        ON o.organization_id = p.organization_id
       AND o.property_id = p.id::text
       AND o.event_type = 'property.archived'
      WHERE p.id = ${PROPERTY_ID}
      GROUP BY p.id
    `)

    expect(result.rows[0]).toMatchObject({
      lifecycle_state: 'archived',
      lifecycle_reason: 'Property no longer trading',
      source_epoch: 8,
      deleted_at: null,
      fact_count: 1,
    })
    expect(new Date(String(result.rows[0]?.purge_scheduled_for))).toEqual(
      RECOVERY_DEADLINE,
    )
    expect(events.emit).toHaveBeenCalledWith(event)
  })

  it('rolls the lifecycle update back when the required fact cannot be inserted', async () => {
    const event = archiveEvent()
    await db.execute(sql`
      INSERT INTO outbox_events (
        id, event_type, event_version, payload, organization_id,
        property_id, source_context, source_aggregate_id, created_at
      ) VALUES (
        ${event.eventId}, 'test.collision', 1, '{}'::jsonb, ${ORGANIZATION_ID},
        ${PROPERTY_ID}, 'property', ${PROPERTY_ID}, ${NOW}
      )
    `)

    await expect(
      createPropertyLifecycleCommandStore(db, events, 'us').transitionLifecycle(
        archiveCommand(event),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } })

    const result = await db.execute(sql`
      SELECT lifecycle_state, lifecycle_reason, purge_scheduled_for, source_epoch
      FROM properties
      WHERE id = ${PROPERTY_ID}
    `)
    expect(result.rows[0]).toEqual({
      lifecycle_state: 'active',
      lifecycle_reason: null,
      purge_scheduled_for: null,
      source_epoch: 7,
    })
    expect(events.emit).not.toHaveBeenCalled()
  })

  it('refuses a Property assigned to another Data Cell without any write', async () => {
    const event = archiveEvent()

    await expect(
      createPropertyLifecycleCommandStore(db, events, 'europe').transitionLifecycle(
        archiveCommand(event),
      ),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'property_not_found',
    })

    const result = await db.execute(sql`
      SELECT
        p.lifecycle_state,
        p.source_epoch,
        count(o.id)::int AS fact_count
      FROM properties p
      LEFT JOIN outbox_events o ON o.organization_id = p.organization_id
      WHERE p.id = ${PROPERTY_ID}
      GROUP BY p.id
    `)
    expect(result.rows[0]).toEqual({
      lifecycle_state: 'active',
      source_epoch: 7,
      fact_count: 0,
    })
    expect(events.emit).not.toHaveBeenCalled()
  })
})
