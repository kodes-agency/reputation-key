import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createPortalResponsibleManagerRepository } from './portal-responsible-manager.repository'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createPostgresPortalFixtureStore } from '../testing/postgres-portal-fixture-store'

const ORG = 'org-portal-responsible-manager'
const PROPERTY = 'c9000000-0000-4000-8000-000000000001'
const PORTAL = 'c9000000-0000-4000-8000-000000000002'
const PORTAL_B = 'c9000000-0000-4000-8000-000000000003'
const START = new Date('2026-08-25T10:00:00.000Z')
const REGRESSED = new Date('2026-08-25T09:00:00.000Z')
const FURTHER_REGRESSED = new Date('2026-08-25T08:00:00.000Z')
const CHANGE = new Date('2026-08-25T11:00:00.000Z')
const UNASSIGNED = new Date('2026-08-25T12:00:00.000Z')
const FUTURE_REVISION = new Date('2026-08-25T13:00:00.000Z')
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
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Responsible Property', 'portal-responsible-manager', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portal_responsible_managers WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
  clearEventSchemas()
})

beforeEach(async () => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portal_responsible_managers WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
})

const portal = () =>
  buildTestPortal({
    id: PORTAL,
    organizationId: organizationId(ORG),
    propertyId: propertyId(PROPERTY),
    entityId: propertyId(PROPERTY),
    publicationState: 'draft',
    createdBy: userId('admin-1'),
    responsibleManagerRevision: 1,
    responsibilityNeededSince: null,
    createdAt: START,
    updatedAt: START,
  })

describe('portal responsible manager repository', () => {
  it('offboarding preserves other managers and raises recovery only for the last one', async () => {
    const db = getDb()
    await createPostgresPortalFixtureStore(db).insert(
      organizationId(ORG),
      portal(),
      userId('admin-1'),
    )
    const repo = createPortalResponsibleManagerRepository(db)
    await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      managerUserIds: ['admin-1', 'manager-1'],
      expectedRevision: 1,
      actorId: 'admin-1',
      at: CHANGE,
    })

    expect(await repo.listActiveForUser(ORG, 'manager-1')).toHaveLength(1)
    expect(
      await repo.releaseForUser({
        organizationId: ORG,
        userId: 'manager-1',
        portalIds: [],
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
    expect((await repo.listActive(ORG, PORTAL)).map((row) => row.userId)).toEqual([
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
    expect(await repo.listActive(ORG, PORTAL)).toEqual([])
    expect(
      await repo.releaseForUser({
        organizationId: ORG,
        userId: 'admin-1',
        at: new Date(UNASSIGNED.getTime() + 2_000),
        endReason: 'manager_offboarded',
      }),
    ).toEqual({ released: 0, responsibilityNeededEvents: [] })
  })

  it('persists the eligible creator default atomically with the portal', async () => {
    const db = getDb()
    await createPostgresPortalFixtureStore(db).insert(
      organizationId(ORG),
      portal(),
      userId('admin-1'),
    )

    const assignments = await createPortalResponsibleManagerRepository(db).listActive(
      ORG,
      PORTAL,
    )
    expect(assignments).toEqual([
      expect.objectContaining({
        portalId: PORTAL,
        userId: 'admin-1',
        effectiveFrom: START,
        createdBy: 'admin-1',
      }),
    ])
  })

  it('deletes zero-length intervals while retaining regressed business occurrence times', async () => {
    const db = getDb()
    await createPostgresPortalFixtureStore(db).insert(
      organizationId(ORG),
      portal(),
      userId('admin-1'),
    )
    const repo = createPortalResponsibleManagerRepository(db)

    await expect(
      repo.replace({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        managerUserIds: ['manager-1'],
        expectedRevision: 1,
        actorId: 'admin-1',
        at: REGRESSED,
      }),
    ).resolves.toMatchObject({ revision: 2 })
    expect(await repo.listActive(ORG, PORTAL)).toEqual([
      expect.objectContaining({ userId: 'manager-1', effectiveFrom: REGRESSED }),
    ])

    await expect(
      repo.releaseForUser({
        organizationId: ORG,
        userId: 'manager-1',
        at: FURTHER_REGRESSED,
        endReason: 'manager_offboarded',
      }),
    ).resolves.toMatchObject({ released: 1 })
    expect(await repo.listActive(ORG, PORTAL)).toEqual([])

    const facts = await pool.query(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN (
           'portal.responsible_managers.updated',
           'portal.responsibility_became_needed'
         )
       ORDER BY created_at, event_type`,
      [ORG],
    )
    expect(facts.rows).toHaveLength(3)
    expect(facts.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'portal.responsible_managers.updated',
          payload: expect.objectContaining({
            assignmentCount: 0,
            sourceAggregateVersion: new Date(START.getTime() + 2).toISOString(),
            occurredAt: FURTHER_REGRESSED.toISOString(),
          }),
        }),
        expect.objectContaining({
          event_type: 'portal.responsibility_became_needed',
          payload: expect.objectContaining({
            sourceAggregateVersion: new Date(START.getTime() + 2).toISOString(),
            occurredAt: FURTHER_REGRESSED.toISOString(),
          }),
        }),
        expect.objectContaining({
          event_type: 'portal.responsible_managers.updated',
          payload: expect.objectContaining({
            assignmentCount: 1,
            sourceAggregateVersion: new Date(START.getTime() + 1).toISOString(),
            occurredAt: REGRESSED.toISOString(),
          }),
        }),
      ]),
    )
  })

  it('records one resulting-count fact per Portal when a multi-Portal release leaves a manager', async () => {
    const db = getDb()
    const fixtureStore = createPostgresPortalFixtureStore(db)
    for (const id of [PORTAL, PORTAL_B]) {
      await fixtureStore.insert(
        organizationId(ORG),
        buildTestPortal({
          ...portal(),
          id,
          slug: `responsibility-${id}`,
        }),
        userId('admin-1'),
      )
    }
    const repo = createPortalResponsibleManagerRepository(db)
    for (const id of [PORTAL, PORTAL_B]) {
      await repo.replace({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
        actorId: 'admin-1',
        at: CHANGE,
      })
    }

    await expect(
      repo.releaseForUser({
        organizationId: ORG,
        userId: 'manager-1',
        at: UNASSIGNED,
        endReason: 'manager_offboarded',
      }),
    ).resolves.toEqual({ released: 2, responsibilityNeededEvents: [] })

    const facts = await pool.query(
      `SELECT event_version, payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'portal.responsible_managers.updated'
         AND payload->>'occurredAt' = $2
       ORDER BY payload->>'portalId'`,
      [ORG, UNASSIGNED.toISOString()],
    )
    expect(facts.rows).toEqual(
      [PORTAL, PORTAL_B].map((id) => ({
        event_version: 2,
        payload: expect.objectContaining({
          portalId: id,
          assignmentCount: 1,
          sourceAggregateVersion: UNASSIGNED.toISOString(),
          occurredAt: UNASSIGNED.toISOString(),
        }),
      })),
    )
    expect(await repo.listActiveForUser(ORG, 'admin-1')).toHaveLength(2)
  })

  it('preserves unchanged intervals, supports multiple managers, and exposes unowned state', async () => {
    const db = getDb()
    await createPostgresPortalFixtureStore(db).insert(
      organizationId(ORG),
      portal(),
      userId('admin-1'),
    )
    const repo = createPortalResponsibleManagerRepository(db)
    const [original] = await repo.listActive(ORG, PORTAL)

    const expanded = await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      managerUserIds: ['admin-1', 'manager-1'],
      expectedRevision: 1,
      actorId: 'admin-1',
      at: CHANGE,
    })
    expect(expanded.revision).toBe(2)
    expect(expanded.assignments).toEqual([
      expect.objectContaining({
        id: original.id,
        userId: 'admin-1',
        effectiveFrom: START,
      }),
      expect.objectContaining({ userId: 'manager-1', effectiveFrom: CHANGE }),
    ])

    await expect(
      repo.replace({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTAL,
        managerUserIds: ['admin-1'],
        expectedRevision: 1,
        actorId: 'admin-1',
        at: UNASSIGNED,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    await pool.query('UPDATE portals SET updated_at = $1 WHERE id = $2', [
      FUTURE_REVISION,
      PORTAL,
    ])

    const unassigned = await repo.replace({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      managerUserIds: [],
      expectedRevision: 2,
      actorId: 'admin-1',
      at: UNASSIGNED,
    })
    expect(unassigned).toMatchObject({
      assignments: [],
      revision: 3,
      becameResponsibilityNeeded: true,
    })
    const row = await pool.query(
      `SELECT responsible_manager_revision, responsibility_needed_since
       FROM portals WHERE id = $1`,
      [PORTAL],
    )
    expect(row.rows[0].responsible_manager_revision).toBe(3)
    expect(new Date(row.rows[0].responsibility_needed_since)).toEqual(UNASSIGNED)
    const outbox = await pool.query(
      `SELECT event_type, event_version, organization_id, property_id, source_aggregate_id, payload
       FROM outbox_events WHERE organization_id = $1
       ORDER BY event_type, created_at`,
      [ORG],
    )
    const recovery = outbox.rows.find(
      (fact) => fact.event_type === 'portal.responsibility_became_needed',
    )
    expect(recovery).toMatchObject({
      event_version: 2,
      organization_id: ORG,
      property_id: PROPERTY,
      // The shared outbox adapter currently groups portal facts at property
      // scope when both ids are present; the payload retains the portal id.
      source_aggregate_id: PROPERTY,
    })
    expect(recovery?.payload).toMatchObject({
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceAggregateVersion: new Date(FUTURE_REVISION.getTime() + 1).toISOString(),
      occurredAt: UNASSIGNED.toISOString(),
    })
    expect(
      outbox.rows
        .filter((fact) => fact.event_type === 'portal.responsible_managers.updated')
        .map((fact) => ({ eventVersion: fact.event_version, payload: fact.payload })),
    ).toEqual([
      expect.objectContaining({
        eventVersion: 2,
        payload: expect.objectContaining({ assignmentCount: 2 }),
      }),
      expect.objectContaining({
        eventVersion: 2,
        payload: expect.objectContaining({
          assignmentCount: 0,
          sourceAggregateVersion: new Date(FUTURE_REVISION.getTime() + 1).toISOString(),
          occurredAt: UNASSIGNED.toISOString(),
        }),
      }),
    ])
  })
})
