// Restore and a release of the Property's last Responsible Manager, at the same
// moment, against real PostgreSQL and through the built Property context.
//
// Restore asks whether an eligible Responsible Manager is assigned, then commits
// the transition in a transaction of its own. A release of an archived Property
// is silent: it records the gap and raises no "Responsible Manager needed",
// because Restore will ask for a manager anyway. So a release that commits
// between Restore's check and its transition must stop that Restore, or the
// Property comes back active with no manager and nobody is told.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildPropertyContext } from '../build'
import { createPropertyRepository } from './repositories/property.repository'

const db = getDb()
const ORG = organizationId('org-property-restore-manager-fence')
const ADMIN = userId('admin-restore-manager-fence')
const MANAGER = userId('manager-restore-manager-fence')
const PROPERTY = propertyId('f5200000-0000-4000-8000-000000000001')
const ARCHIVED_AT = new Date('2026-10-01T09:00:00.000Z')
const RECOVERY_DEADLINE = new Date('2026-10-31T09:00:00.000Z')
const RELEASED_AT = new Date('2026-10-13T08:59:59.000Z')
const RESTORED_AT = new Date('2026-10-13T09:00:00.000Z')
const SOURCE_EPOCH = 4
const MANAGER_REVISION = 2

/** Runs once, after Restore's check has read its answer and before it commits. */
let afterRestoreCheck: (() => Promise<unknown>) | null = null

const property = buildPropertyContext({
  db,
  repo: createPropertyRepository(db),
  outboxRepo: createOutboxRepository(db),
  clock: () => RESTORED_AT,
  idGen: () => 'f5200000-0000-4000-8000-0000000000ff',
  staffPublicApi: {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  },
  identityManagerFacts: {
    // The last read Restore's check makes. The manager is still a member with
    // access here; what changes underneath is the assignment.
    listActiveManagers: async () => {
      const interleaved = afterRestoreCheck
      afterRestoreCheck = null
      await interleaved?.()
      return [
        { userId: MANAGER, role: 'PropertyManager', propertyAccessScope: 'organization' },
      ]
    },
  },
  logger: { info: () => {}, warn: () => {} },
})

const admin = buildTestAuthContext({
  userId: ADMIN,
  organizationId: ORG,
  role: 'AccountAdmin',
  effectivePermissions: new Set(['property.restore']),
  scopeByPermission: new Map([['property.restore', 'organization']]),
})

const restore = () =>
  property.publicApi.management.restoreProperty({ propertyId: PROPERTY }, admin)

/** What Identity does when the manager's Property access is taken away. */
const releaseManager = () =>
  property.responsibility.releaseForUser({
    organizationId: ORG,
    userId: MANAGER,
    propertyIds: [PROPERTY],
    at: RELEASED_AT,
    endReason: 'manager_became_ineligible',
    actorId: ADMIN,
  })

async function readProperty() {
  const result = await db.execute(sql`
    SELECT
      p.lifecycle_state,
      p.source_epoch,
      p.responsible_manager_revision,
      p.responsibility_needed_since IS NOT NULL AS manager_needed,
      (SELECT count(*)::int FROM property_responsible_managers m
        WHERE m.property_id = p.id AND m.effective_to IS NULL) AS active_managers
    FROM properties p
    WHERE p.id = ${PROPERTY}
  `)
  return result.rows[0]
}

async function factTypes() {
  const result = await db.execute(sql`
    SELECT event_type FROM outbox_events
    WHERE organization_id = ${ORG}
    ORDER BY event_type
  `)
  return result.rows.map((row) => row.event_type)
}

async function clearRows() {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(
    sql`DELETE FROM property_responsible_managers WHERE organization_id = ${ORG}`,
  )
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Property Restore Manager Fence', ${ORG}, ${ARCHIVED_AT})
    ON CONFLICT (id) DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      ${PROPERTY}, ${ORG}, 'Harbour Hotel', 'harbour-hotel-manager-fence', 'UTC',
      ${ARCHIVED_AT}, ${ARCHIVED_AT}
    )
    ON CONFLICT (id) DO NOTHING
  `)
})

// Archived inside its recovery window, with one Responsible Manager assigned.
beforeEach(async () => {
  afterRestoreCheck = null
  await clearRows()
  await db.execute(sql`
    UPDATE properties
    SET lifecycle_state = 'archived',
        lifecycle_reason = 'Closed for the winter',
        lifecycle_state_changed_at = ${ARCHIVED_AT},
        purge_scheduled_for = ${RECOVERY_DEADLINE},
        lifecycle_initiated_by = ${ADMIN},
        source_epoch = ${SOURCE_EPOCH},
        responsible_manager_revision = ${MANAGER_REVISION},
        responsibility_needed_since = NULL,
        updated_at = ${ARCHIVED_AT}
    WHERE id = ${PROPERTY}
  `)
  await db.execute(sql`
    INSERT INTO property_responsible_managers
      (organization_id, property_id, user_id, effective_from, created_by)
    VALUES (${ORG}, ${PROPERTY}, ${MANAGER}, ${ARCHIVED_AT}, ${ADMIN})
  `)
})

afterAll(async () => {
  await clearRows()
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY}`)
  await deleteTestOrganizations(db, [ORG])
  clearEventSchemas()
})

describe.sequential('Restore while the last Responsible Manager is released', () => {
  it('refuses a Restore whose manager was released after it checked', async () => {
    afterRestoreCheck = releaseManager

    await expect(restore()).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'stale_property',
    })

    // Still archived: the release stays the silent one of an archived Property.
    expect(await readProperty()).toEqual({
      lifecycle_state: 'archived',
      source_epoch: SOURCE_EPOCH,
      responsible_manager_revision: MANAGER_REVISION + 1,
      manager_needed: true,
      active_managers: 0,
    })
    expect(await factTypes()).toEqual([])

    // Asked again, Restore sees the gap and says what to do about it.
    await expect(restore()).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'property_restore_not_ready',
    })
  })

  it('announces the gap when the release commits after the Restore', async () => {
    const restored = await restore()
    expect(restored.property).toMatchObject({
      lifecycleState: 'active',
      sourceEpoch: SOURCE_EPOCH + 1,
    })

    await expect(releaseManager()).resolves.toEqual({ released: 1 })

    expect(await readProperty()).toEqual({
      lifecycle_state: 'active',
      source_epoch: SOURCE_EPOCH + 1,
      responsible_manager_revision: MANAGER_REVISION + 1,
      manager_needed: true,
      active_managers: 0,
    })
    expect(await factTypes()).toEqual([
      'property.responsibility_became_needed',
      'property.restored',
    ])
  })

  it('restores when the managers did not change after the check', async () => {
    const restored = await restore()

    expect(restored.property).toMatchObject({
      lifecycleState: 'active',
      responsibleManagerRevision: MANAGER_REVISION,
      responsibilityNeededSince: null,
    })
    expect(await readProperty()).toMatchObject({
      lifecycle_state: 'active',
      active_managers: 1,
      manager_needed: false,
    })
  })
})
