import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { propertyResponsibilityNeeded } from '../../domain/events'
import { createPropertyResponsibleManagerRepository } from './property-responsible-manager.repository'

const ORG = 'org-property-responsible-manager'
const PROPERTY = 'c9100000-0000-4000-8000-000000000001'
const START = new Date('2026-08-25T10:00:00.000Z')
const CHANGE = new Date('2026-08-25T11:00:00.000Z')
const UNASSIGNED = new Date('2026-08-25T12:00:00.000Z')
let pool: Pool

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM property_responsible_managers WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
  clearEventSchemas()
})

beforeEach(async () => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM property_responsible_managers WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at,
        responsible_manager_revision, responsibility_needed_since)
     VALUES ($1, $2, 'Responsible Property', 'property-responsible-manager',
       'UTC', $3, $3, 1, $3)`,
    [PROPERTY, ORG, START],
  )
})

const recoveryEvent = (at: Date) =>
  propertyResponsibilityNeeded({
    organizationId: organizationId(ORG),
    propertyId: propertyId(PROPERTY),
    occurredAt: at,
  })

describe('Property responsible manager repository', () => {
  it('offboarding ends only the departing manager and raises recovery only for the last one', async () => {
    const repo = createPropertyResponsibleManagerRepository(getDb())
    await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      managerUserIds: ['admin-1', 'manager-1'],
      expectedRevision: 1,
      actorId: 'admin-1',
      at: CHANGE,
      responsibilityNeededEvent: recoveryEvent(CHANGE),
    })

    expect(await repo.listActiveForUser(ORG, 'manager-1')).toHaveLength(1)
    expect(
      await repo.releaseForUser({
        organizationId: ORG,
        userId: 'manager-1',
        propertyIds: [],
        at: UNASSIGNED,
        endReason: 'manager_became_ineligible',
      }),
    ).toEqual({ released: 0, responsibilityNeededEvents: [] })

    const first = await repo.releaseForUser({
      organizationId: ORG,
      userId: 'manager-1',
      at: UNASSIGNED,
      endReason: 'manager_offboarded',
    })
    expect(first).toEqual({ released: 1, responsibilityNeededEvents: [] })
    expect((await repo.listActive(ORG, PROPERTY)).map((row) => row.userId)).toEqual([
      'admin-1',
    ])

    const last = await repo.releaseForUser({
      organizationId: ORG,
      userId: 'admin-1',
      at: new Date(UNASSIGNED.getTime() + 1_000),
      endReason: 'manager_offboarded',
    })
    expect(last.released).toBe(1)
    expect(last.responsibilityNeededEvents).toHaveLength(1)
    expect(await repo.listActive(ORG, PROPERTY)).toEqual([])
    expect(
      await repo.releaseForUser({
        organizationId: ORG,
        userId: 'admin-1',
        at: new Date(UNASSIGNED.getTime() + 2_000),
        endReason: 'manager_offboarded',
      }),
    ).toEqual({ released: 0, responsibilityNeededEvents: [] })
    const history = await pool.query(
      `SELECT user_id, end_reason FROM property_responsible_managers
       WHERE organization_id = $1 ORDER BY user_id`,
      [ORG],
    )
    expect(history.rows).toEqual([
      { user_id: 'admin-1', end_reason: 'manager_offboarded' },
      { user_id: 'manager-1', end_reason: 'manager_offboarded' },
    ])
  })

  it('preserves unchanged intervals, fences stale edits, and records unowned recovery atomically', async () => {
    const repo = createPropertyResponsibleManagerRepository(getDb())
    const assigned = await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      managerUserIds: ['admin-1', 'manager-1'],
      expectedRevision: 1,
      actorId: 'admin-1',
      at: CHANGE,
      responsibilityNeededEvent: recoveryEvent(CHANGE),
    })
    expect(assigned).toMatchObject({
      revision: 2,
      becameResponsibilityNeeded: false,
    })
    expect(assigned.assignments.map((row) => row.userId)).toEqual([
      'admin-1',
      'manager-1',
    ])
    const [original] = assigned.assignments

    await expect(
      repo.replace({
        organizationId: ORG,
        propertyId: PROPERTY,
        managerUserIds: ['admin-1'],
        expectedRevision: 1,
        actorId: 'admin-1',
        at: UNASSIGNED,
        responsibilityNeededEvent: recoveryEvent(UNASSIGNED),
      }),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'revision_conflict' })

    const unchanged = await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      managerUserIds: ['admin-1', 'manager-1'],
      expectedRevision: 2,
      actorId: 'admin-2',
      at: UNASSIGNED,
      responsibilityNeededEvent: recoveryEvent(UNASSIGNED),
    })
    expect(unchanged.revision).toBe(2)
    expect(unchanged.assignments[0]).toMatchObject({
      id: original?.id,
      effectiveFrom: CHANGE,
      createdBy: 'admin-1',
    })

    const unassigned = await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      managerUserIds: [],
      expectedRevision: 2,
      actorId: 'admin-2',
      at: UNASSIGNED,
      responsibilityNeededEvent: recoveryEvent(UNASSIGNED),
    })
    expect(unassigned).toMatchObject({
      assignments: [],
      revision: 3,
      becameResponsibilityNeeded: true,
    })

    const propertyRow = await pool.query(
      `SELECT responsible_manager_revision, responsibility_needed_since
       FROM properties WHERE id = $1`,
      [PROPERTY],
    )
    expect(propertyRow.rows[0].responsible_manager_revision).toBe(3)
    expect(new Date(propertyRow.rows[0].responsibility_needed_since)).toEqual(UNASSIGNED)
    const outbox = await pool.query(
      `SELECT event_type, organization_id, property_id, payload
       FROM outbox_events WHERE organization_id = $1`,
      [ORG],
    )
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        event_type: 'property.responsibility_became_needed',
        organization_id: ORG,
        property_id: PROPERTY,
      }),
    ])
    expect(outbox.rows[0].payload).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
    })
  })
})
