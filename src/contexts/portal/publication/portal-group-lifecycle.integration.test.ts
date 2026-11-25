// Create, rename and archive Portal Groups, and the history they write, on real
// PostgreSQL with two organizations: the results a manager sees, the refusals, the
// facts recorded and the ledger written. The real use cases run over the real
// stores and command store; only the clock and ids are fixed.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  createGroupLifecycleHarness,
  ctxOf,
  EARLIER,
  expectCode,
  GROUP_LIFECYCLE_TABLES,
  MANAGER,
  NEXT,
  NOW,
  ORG_A,
  ORG_B,
  wire,
} from './portal-group-lifecycle.test-fixtures'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [...GROUP_LIFECYCLE_TABLES],
})
const {
  seedProperty,
  seedPortal,
  seedGroup,
  seedMembership,
  groupRows,
  membershipRows,
  factsOf,
  historyRows,
} = createGroupLifecycleHarness(getPool)

describe.sequential('createPortalGroup (real PostgreSQL, two tenants)', () => {
  it('creates a group with its creator, its fact and its history entry', async () => {
    const property = await seedProperty(ORG_A)
    const { create } = wire()

    const group = await create({ name: 'My Group', propertyId: property }, ctxOf(ORG_A))

    expect(group).toMatchObject({ name: 'My Group', createdBy: MANAGER, deletedAt: null })
    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ id: group.id, name: 'My Group', created_by: MANAGER }),
    ])
    expect(await historyRows(ORG_A)).toEqual([
      expect.objectContaining({
        group: group.id,
        kind: 'created',
        name: 'My Group',
        actor: MANAGER,
      }),
    ])
  })

  it('records the created fact without portals and no addition fact', async () => {
    const property = await seedProperty(ORG_A)
    const { create } = wire()

    await create({ name: 'Solo Group', propertyId: property }, ctxOf(ORG_A))

    const facts = await factsOf(ORG_A)
    expect(facts.map((row) => row.event_type)).toEqual(['portal_group.created'])
    expect(facts[0]?.payload).toMatchObject({
      organizationId: ORG_A,
      propertyId: property,
      portalGroupId: (await groupRows(ORG_A))[0]?.id,
    })
  })

  it('records group and membership facts on creation with a Portal', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)
    const { create } = wire()

    const group = await create(
      { name: 'Group With Portals', propertyId: property, portalIds: [portal] },
      ctxOf(ORG_A),
    )

    const created = await factsOf(ORG_A, 'portal_group.created')
    expect(created).toHaveLength(1)
    expect(created[0]?.payload).toMatchObject({
      portalGroupId: group.id,
      propertyId: property,
    })
    const added = await factsOf(ORG_A, 'portal_group.portal_added')
    expect(added).toHaveLength(1)
    expect(added[0]?.payload).toMatchObject({ portalId: portal, portalGroupId: group.id })
    expect(await membershipRows(ORG_A, portal)).toEqual([
      expect.objectContaining({ group: group.id, effective_to: null }),
    ])
  })

  it('refuses a role that cannot create Portal Groups and writes nothing', async () => {
    const property = await seedProperty(ORG_A)
    const { create } = wire()

    await expectCode(
      create({ name: 'Test', propertyId: property }, ctxOf(ORG_A, 'Member')),
      'forbidden',
    )

    expect(await groupRows(ORG_A)).toEqual([])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a duplicate name in the same Property and allows it in another tenant', async () => {
    const property = await seedProperty(ORG_A)
    const otherTenantProperty = await seedProperty(ORG_B)
    const { create } = wire()
    await create({ name: 'My Group', propertyId: property }, ctxOf(ORG_A))

    await expectCode(
      create({ name: 'My Group', propertyId: property }, ctxOf(ORG_A)),
      'group_name_taken',
    )
    expect(await groupRows(ORG_A)).toHaveLength(1)

    await create({ name: 'My Group', propertyId: otherTenantProperty }, ctxOf(ORG_B))
    expect(await groupRows(ORG_B)).toHaveLength(1)
  })

  it('refuses a PropertyManager who is not assigned to the Property and allows an assigned one', async () => {
    const property = await seedProperty(ORG_A)

    await expectCode(
      wire([]).create({ name: 'Test', propertyId: property }, ctxOf(ORG_A)),
      'forbidden',
    )
    expect(await groupRows(ORG_A)).toEqual([])

    const group = await wire([property]).create(
      { name: 'Assigned Group', propertyId: property },
      ctxOf(ORG_A),
    )
    expect(group.name).toBe('Assigned Group')
    expect(await groupRows(ORG_A)).toHaveLength(1)
  })

  it('does not see a Property or a Portal of another organization', async () => {
    const propertyA = await seedProperty(ORG_A)
    const portalA = await seedPortal(ORG_A, propertyA)
    const propertyB = await seedProperty(ORG_B)
    const { create } = wire()

    await expectCode(
      create({ name: 'Foreign', propertyId: propertyA }, ctxOf(ORG_B)),
      'property_not_found',
    )
    await expectCode(
      create(
        { name: 'Foreign portal', propertyId: propertyB, portalIds: [portalA] },
        ctxOf(ORG_B),
      ),
      'portal_not_found',
    )

    expect(await groupRows(ORG_A)).toEqual([])
    expect(await groupRows(ORG_B)).toEqual([])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })
})

describe.sequential('createPortalGroup with Portals that are already grouped', () => {
  async function seedGrouped() {
    const property = await seedProperty(ORG_A)
    const oldA = await seedGroup(ORG_A, property, 'Old A')
    const oldB = await seedGroup(ORG_A, property, 'Old B')
    const portals = [
      await seedPortal(ORG_A, property),
      await seedPortal(ORG_A, property),
      await seedPortal(ORG_A, property),
    ] as const
    return { property, oldA, oldB, portals }
  }

  it('moves them into the new group and ends their old memberships with moved_to_group', async () => {
    const { property, oldA, oldB, portals } = await seedGrouped()
    await seedMembership(ORG_A, property, portals[0], oldA)
    await seedMembership(ORG_A, property, portals[1], oldB)
    const { create } = wire()

    const group = await create(
      { name: 'New', propertyId: property, portalIds: [...portals] },
      ctxOf(ORG_A),
    )

    expect(await membershipRows(ORG_A, portals[0])).toEqual([
      expect.objectContaining({ group: oldA, end_reason: 'moved_to_group' }),
      expect.objectContaining({ group: group.id, effective_to: null }),
    ])
    expect(await membershipRows(ORG_A, portals[1])).toEqual([
      expect.objectContaining({ group: oldB, end_reason: 'moved_to_group' }),
      expect.objectContaining({ group: group.id, effective_to: null }),
    ])
    expect(await membershipRows(ORG_A, portals[2])).toEqual([
      expect.objectContaining({ group: group.id, effective_to: null }),
    ])
  })

  it('fences each old group once however many Portals leave it', async () => {
    const { property, oldA, portals } = await seedGrouped()
    await seedMembership(ORG_A, property, portals[0], oldA)
    await seedMembership(ORG_A, property, portals[1], oldA)
    const { create } = wire()

    await create(
      { name: 'New', propertyId: property, portalIds: [portals[0], portals[1]] },
      ctxOf(ORG_A),
    )

    const removed = await factsOf(ORG_A, 'portal_group.portal_removed')
    expect(removed).toHaveLength(2)
    expect(
      new Set(removed.map((event) => event.payload.sourceAggregateVersion)).size,
    ).toBe(1)
    const rows = await groupRows(ORG_A)
    expect(rows.find((row) => row.id === oldA)?.updated_at).toEqual(NOW)
  })

  it('records who created the group and writes its history, moves included', async () => {
    const { property, oldA, portals } = await seedGrouped()
    await seedMembership(ORG_A, property, portals[0], oldA)
    const { create } = wire()

    const group = await create(
      { name: 'New', propertyId: property, portalIds: [portals[0], portals[2]] },
      ctxOf(ORG_A),
    )

    expect(group.createdBy).toBe(MANAGER)
    const history = (await historyRows(ORG_A)).map((row) => [
      row.group,
      row.kind,
      row.portal,
    ])
    expect(history).toHaveLength(4)
    expect(history).toEqual(
      expect.arrayContaining([
        [group.id, 'created', null],
        [oldA, 'portal_moved_out', portals[0]],
        [group.id, 'portal_moved_in', portals[0]],
        [group.id, 'portal_added', portals[2]],
      ]),
    )
    expect(
      (await historyRows(ORG_A)).find((row) => row.kind === 'created'),
    ).toMatchObject({ name: 'New', actor: MANAGER })
  })

  it('counts a Portal listed twice once', async () => {
    const { property, oldA, portals } = await seedGrouped()
    await seedMembership(ORG_A, property, portals[0], oldA)
    const { create } = wire()

    const group = await create(
      { name: 'New', propertyId: property, portalIds: [portals[0], portals[0]] },
      ctxOf(ORG_A),
    )

    const open = (await membershipRows(ORG_A, portals[0])).filter(
      (row) => row.effective_to === null,
    )
    expect(open).toEqual([expect.objectContaining({ group: group.id })])
    expect(await factsOf(ORG_A, 'portal_group.portal_added')).toHaveLength(1)
  })

  it('refuses a Portal of another Property before anything is written', async () => {
    const { property, portals } = await seedGrouped()
    const otherProperty = await seedProperty(ORG_A)
    const { create } = wire()

    await expectCode(
      create(
        { name: 'New', propertyId: otherProperty, portalIds: [portals[0]] },
        ctxOf(ORG_A),
      ),
      'forbidden',
    )

    expect((await groupRows(ORG_A)).map((row) => row.name)).toEqual(['Old A', 'Old B'])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await membershipRows(ORG_A, portals[0])).toEqual([])
    expect(property).toBeDefined()
  })
})

describe.sequential('group history written by the group commands', () => {
  it('records a rename with the previous name, and nothing when the name is unchanged', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Old A')
    const { update } = wire()

    await update({ portalGroupId: group, name: 'Renamed' }, ctxOf(ORG_A))
    await update({ portalGroupId: group, name: 'Renamed' }, ctxOf(ORG_A))

    expect(await historyRows(ORG_A)).toEqual([
      expect.objectContaining({
        kind: 'renamed',
        group,
        name: 'Renamed',
        previous: 'Old A',
        actor: MANAGER,
      }),
    ])
  })

  it('records an archive, an addition and a removal with their actor', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Old A')
    const portal = await seedPortal(ORG_A, property)
    const { add, remove, archive } = wire()

    await add({ portalGroupId: group, portalId: portal }, ctxOf(ORG_A))
    await remove({ portalGroupId: group, portalId: portal }, ctxOf(ORG_A))
    await archive({ portalGroupId: group }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(
      (await historyRows(ORG_A)).map((entry) => [entry.kind, entry.actor]).sort(),
    ).toEqual(
      [
        ['portal_added', MANAGER],
        ['portal_removed', MANAGER],
        ['archived', MANAGER],
      ].sort(),
    )
  })
})

describe.sequential('updatePortalGroup (real PostgreSQL, two tenants)', () => {
  it('updates the group name, returns the next revision and records the fact', async () => {
    const property = await seedProperty(ORG_A)
    const current = new Date('2026-10-01T12:00:00.000Z')
    const group = await seedGroup(ORG_A, property, 'Old Name', current)
    const next = new Date(current.getTime() + 1)
    const { update } = wire()

    const result = await update({ portalGroupId: group, name: 'New Name' }, ctxOf(ORG_A))

    expect(result).toMatchObject({ name: 'New Name', updatedAt: next })
    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ id: group, name: 'New Name', updated_at: next }),
    ])
    const facts = await factsOf(ORG_A, 'portal_group.updated')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload).toMatchObject({
      portalGroupId: group,
      sourceAggregateVersion: next.toISOString(),
    })
  })

  it('refuses a missing group and a group of another organization', async () => {
    const propertyA = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, propertyA, 'Old Name')
    const { update } = wire()

    await expectCode(
      update({ portalGroupId: randomUUID(), name: 'New' }, ctxOf(ORG_A)),
      'group_not_found',
    )
    await expectCode(
      update({ portalGroupId: group, name: 'Taken over' }, ctxOf(ORG_B)),
      'group_not_found',
    )

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ name: 'Old Name', updated_at: EARLIER }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('refuses a role without portal.update and a manager who is not assigned', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Old Name')

    await expectCode(
      wire().update({ portalGroupId: group, name: 'New' }, ctxOf(ORG_A, 'Member')),
      'forbidden',
    )
    await expectCode(
      wire([]).update({ portalGroupId: group, name: 'New' }, ctxOf(ORG_A)),
      'forbidden',
    )

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ name: 'Old Name' }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('allows a PropertyManager assigned to the Property', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Old Name')

    const result = await wire([property]).update(
      { portalGroupId: group, name: 'New Name' },
      ctxOf(ORG_A),
    )

    expect(result.name).toBe('New Name')
    expect(await factsOf(ORG_A, 'portal_group.updated')).toHaveLength(1)
  })
})

describe.sequential('softDeletePortalGroup (real PostgreSQL, two tenants)', () => {
  it('archives a group, ends its memberships and records the fact (AccountAdmin bypasses assignment)', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group', NOW)
    const portal = await seedPortal(ORG_A, property)
    await seedMembership(ORG_A, property, portal, group)
    const { archive } = wire(null)

    await archive({ portalGroupId: group }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ id: group, deleted_at: NOW, updated_at: NEXT }),
    ])
    expect(await membershipRows(ORG_A, portal)).toEqual([
      expect.objectContaining({ group, end_reason: 'group_archived' }),
    ])
    const facts = await factsOf(ORG_A, 'portal_group.deleted')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload).toMatchObject({ portalGroupId: group })
  })

  it('refuses a Member, who lacks portal.delete', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group')

    await expectCode(
      wire(null).archive({ portalGroupId: group }, ctxOf(ORG_A, 'Member')),
      'forbidden',
    )

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a PropertyManager, who is not granted portal.delete', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group')

    await expectCode(
      wire([]).archive({ portalGroupId: group }, ctxOf(ORG_A)),
      'forbidden',
    )

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
  })

  it('refuses a missing group and a group of another organization', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group')
    const { archive } = wire(null)

    await expectCode(
      archive({ portalGroupId: randomUUID() }, ctxOf(ORG_A, 'AccountAdmin')),
      'group_not_found',
    )
    await expectCode(
      archive({ portalGroupId: group }, ctxOf(ORG_B, 'AccountAdmin')),
      'group_not_found',
    )

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })
})
