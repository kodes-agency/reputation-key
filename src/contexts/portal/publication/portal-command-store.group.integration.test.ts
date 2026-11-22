// Portal command store against real PostgreSQL: Portal Group state, membership and facts.

import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import {
  portalAddedToGroup,
  portalGroupCreated,
  portalGroupDeleted,
  portalGroupUpdated,
  portalRemovedFromGroup,
} from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import {
  CREATED_AT,
  DELETED_AT,
  GROUP_A,
  GROUP_B,
  GROUP_UPDATED_AT,
  hasDatabaseErrorCode,
  MANAGER,
  ORG_A,
  PORTAL_A,
  PROPERTY_A,
  seedPortalGroupMembership,
  seedStoredPortal,
  setupPortalCommandStoreTestDb,
  UPDATED_AT,
} from './portal-command-store.test-fixtures'

const { getPool } = setupPortalCommandStoreTestDb()

describe.sequential('Portal command store (real PostgreSQL)', () => {
  it('commits Portal Group archive, membership closure, and lifecycle fact together', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())

    await store.deletePortalGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      expectedUpdatedAt: GROUP_UPDATED_AT,
      revision: DELETED_AT,
      occurredAt: DELETED_AT,
      changedBy: MANAGER,
      event,
    })

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to, end_reason FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id, event_type, event_version FROM outbox_events
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ deleted_at: DELETED_AT, updated_at: DELETED_AT }])
    expect(membership.rows).toEqual([
      { effective_to: DELETED_AT, end_reason: 'group_archived' },
    ])
    expect(fact.rows).toEqual([
      { id: event.eventId, event_type: 'portal_group.deleted', event_version: 2 },
    ])
  })

  it('rolls back Portal Group archive and membership closure when its fact fails', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_group.deleted', 1, '{}'::jsonb, $2, $3,
               'portal', $4, $5)`,
      [event.eventId, ORG_A, PROPERTY_A, GROUP_A, DELETED_AT],
    )
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())

    await expect(
      store.deletePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        revision: DELETED_AT,
        occurredAt: DELETED_AT,
        changedBy: MANAGER,
        event,
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to, end_reason FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    expect(group.rows).toEqual([{ deleted_at: null, updated_at: GROUP_UPDATED_AT }])
    expect(membership.rows).toEqual([{ effective_to: null, end_reason: null }])
  })

  it('rejects a stale Portal Group delete without changing membership or recording a fact', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupDeleted({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })

    await expect(
      createAtomicPortalCommandStore(
        getDb(),
        createPortalRatingGoalGuard(),
      ).deletePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: CREATED_AT,
        revision: DELETED_AT,
        occurredAt: DELETED_AT,
        changedBy: MANAGER,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const group = await getPool().query(
      `SELECT deleted_at, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const membership = await getPool().query(
      `SELECT effective_to FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ deleted_at: null, updated_at: GROUP_UPDATED_AT }])
    expect(membership.rows).toEqual([{ effective_to: null }])
    expect(fact.rows).toHaveLength(0)
  })

  it('rolls back a new Portal Group and all initial memberships when one fact conflicts', async () => {
    const { store } = await seedStoredPortal()
    const group = {
      id: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Front Desk',
      sortKey: null,
      createdBy: MANAGER,
      createdAt: GROUP_UPDATED_AT,
      updatedAt: GROUP_UPDATED_AT,
      deletedAt: null,
    } as const
    const created = portalGroupCreated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: group.name,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    await getPool().query(
      `INSERT INTO outbox_events
         (id, event_type, event_version, payload, organization_id, property_id,
          source_context, source_aggregate_id, created_at)
       VALUES ($1, 'portal_group.portal_added', 1, '{}'::jsonb, $2, $3,
               'portal_group', $4, $5)`,
      [added.eventId, ORG_A, PROPERTY_A, GROUP_A, GROUP_UPDATED_AT],
    )

    await expect(
      store.createPortalGroup({
        organizationId: ORG_A,
        group,
        changedBy: MANAGER,
        memberships: [{ portalId: PORTAL_A, createdBy: MANAGER, movedFrom: null }],
        sourceGroups: [],
        events: [created, added],
      }),
    ).rejects.toSatisfy((error: unknown) => hasDatabaseErrorCode(error, '23505'))

    const persistedGroup = await getPool().query(
      `SELECT id FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const memberships = await getPool().query(
      `SELECT id FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    const createdOutbox = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, created.eventId],
    )
    expect(persistedGroup.rows).toHaveLength(0)
    expect(memberships.rows).toHaveLength(0)
    expect(createdOutbox.rows).toHaveLength(0)
  })

  it('commits a new Portal Group, initial membership, and content-free facts together', async () => {
    const { store } = await seedStoredPortal()
    const group = {
      id: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Front Desk',
      sortKey: null,
      createdBy: MANAGER,
      createdAt: GROUP_UPDATED_AT,
      updatedAt: GROUP_UPDATED_AT,
      deletedAt: null,
    } as const
    const created = portalGroupCreated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: group.name,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      occurredAt: GROUP_UPDATED_AT,
    })

    await store.createPortalGroup({
      organizationId: ORG_A,
      group,
      changedBy: MANAGER,
      memberships: [{ portalId: PORTAL_A, createdBy: MANAGER, movedFrom: null }],
      sourceGroups: [],
      events: [created, added],
    })

    const state = await getPool().query(
      `SELECT g.name, g.updated_at, m.portal_id
       FROM portal_groups g
       JOIN portal_group_memberships m ON m.portal_group_id = g.id
       WHERE g.organization_id = $1 AND g.id = $2`,
      [ORG_A, GROUP_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal_group.%'
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(state.rows).toEqual([
      { name: 'Front Desk', updated_at: GROUP_UPDATED_AT, portal_id: PORTAL_A },
    ])
    expect(facts.rows).toHaveLength(2)
    for (const fact of facts.rows) {
      expect(fact.payload).toMatchObject({
        propertyId: PROPERTY_A,
        sourceAggregateVersion: GROUP_UPDATED_AT.toISOString(),
      })
      expect(fact.payload).not.toHaveProperty('name')
    }
  })

  it('rejects a stale Portal Group rename without changing state or recording its fact', async () => {
    await seedPortalGroupMembership()
    const event = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Guest Services',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })

    await expect(
      createAtomicPortalCommandStore(
        getDb(),
        createPortalRatingGoalGuard(),
      ).updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: CREATED_AT,
        name: 'Guest Services',
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        previousName: 'Front Desk',
        changedBy: MANAGER,
        event,
      }),
    ).rejects.toMatchObject({ _tag: 'PortalError', code: 'revision_conflict' })

    const group = await getPool().query(
      `SELECT name, updated_at FROM portal_groups
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const fact = await getPool().query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND id = $2`,
      [ORG_A, event.eventId],
    )
    expect(group.rows).toEqual([{ name: 'Front Desk', updated_at: GROUP_UPDATED_AT }])
    expect(fact.rows).toHaveLength(0)
  })

  it('serializes concurrent Portal Group renames through one aggregate revision', async () => {
    await seedPortalGroupMembership()
    const firstEvent = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Guest Services',
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const secondEvent = portalGroupUpdated({
      portalGroupId: GROUP_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      name: 'Reception Team',
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
    const results = await Promise.allSettled([
      store.updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        name: 'Guest Services',
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        previousName: 'Front Desk',
        changedBy: MANAGER,
        event: firstEvent,
      }),
      store.updatePortalGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        name: 'Reception Team',
        revision: DELETED_AT,
        occurredAt: DELETED_AT,
        previousName: 'Front Desk',
        changedBy: MANAGER,
        event: secondEvent,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'PortalError', code: 'revision_conflict' },
    })
    const facts = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [ORG_A, [firstEvent.eventId, secondEvent.eventId]],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('commits membership add and removal with each fenced Portal Group fact', async () => {
    const { store } = await seedStoredPortal()
    await getPool().query(
      `INSERT INTO portal_groups
         (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Front Desk', $4, $5)`,
      [GROUP_A, ORG_A, PROPERTY_A, CREATED_AT, GROUP_UPDATED_AT],
    )
    const added = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    await store.addPortalToGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: GROUP_UPDATED_AT,
      revision: UPDATED_AT,
      occurredAt: UPDATED_AT,
      changedBy: MANAGER,
      event: added,
    })
    const removed = portalRemovedFromGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })
    await store.removePortalFromGroup({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      expectedUpdatedAt: UPDATED_AT,
      revision: DELETED_AT,
      occurredAt: DELETED_AT,
      changedBy: MANAGER,
      event: removed,
    })

    const membership = await getPool().query(
      `SELECT effective_from, effective_to, end_reason
       FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_group_id = $2 AND portal_id = $3`,
      [ORG_A, GROUP_A, PORTAL_A],
    )
    const group = await getPool().query(
      `SELECT updated_at FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, GROUP_A],
    )
    const facts = await getPool().query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('portal_group.portal_added', 'portal_group.portal_removed')
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(membership.rows).toEqual([
      {
        effective_from: UPDATED_AT,
        effective_to: DELETED_AT,
        end_reason: 'removed_from_group',
      },
    ])
    expect(group.rows).toEqual([{ updated_at: DELETED_AT }])
    expect(facts.rows).toEqual([
      {
        event_type: 'portal_group.portal_added',
        payload: expect.objectContaining({
          propertyId: PROPERTY_A,
          sourceAggregateVersion: UPDATED_AT.toISOString(),
        }),
      },
      {
        event_type: 'portal_group.portal_removed',
        payload: expect.objectContaining({
          propertyId: PROPERTY_A,
          sourceAggregateVersion: DELETED_AT.toISOString(),
        }),
      },
    ])
  })

  it('serializes competing group additions for the same Portal', async () => {
    const { store } = await seedStoredPortal()
    await getPool().query(
      `INSERT INTO portal_groups
         (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $3, $4, 'Front Desk', $5, $5),
              ($2, $3, $4, 'Guest Services', $5, $5)`,
      [GROUP_A, GROUP_B, ORG_A, PROPERTY_A, GROUP_UPDATED_AT],
    )
    const firstEvent = portalAddedToGroup({
      portalGroupId: GROUP_A,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: UPDATED_AT.toISOString(),
      occurredAt: UPDATED_AT,
    })
    const secondEvent = portalAddedToGroup({
      portalGroupId: GROUP_B,
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: DELETED_AT.toISOString(),
      occurredAt: DELETED_AT,
    })

    const results = await Promise.allSettled([
      store.addPortalToGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_A,
        portalId: PORTAL_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        revision: UPDATED_AT,
        occurredAt: UPDATED_AT,
        changedBy: MANAGER,
        event: firstEvent,
      }),
      store.addPortalToGroup({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        portalGroupId: GROUP_B,
        portalId: PORTAL_A,
        expectedUpdatedAt: GROUP_UPDATED_AT,
        revision: DELETED_AT,
        occurredAt: DELETED_AT,
        changedBy: MANAGER,
        event: secondEvent,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'PortalError', code: 'portal_already_grouped' },
    })
    const activeMemberships = await getPool().query(
      `SELECT portal_group_id FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_id = $2 AND effective_to IS NULL`,
      [ORG_A, PORTAL_A],
    )
    expect(activeMemberships.rows).toHaveLength(1)
    const facts = await getPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [ORG_A, [firstEvent.eventId, secondEvent.eventId]],
    )
    expect(facts.rows).toHaveLength(1)
  })
})
