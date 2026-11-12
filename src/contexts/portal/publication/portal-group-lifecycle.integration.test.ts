// Create, rename, archive and list the history of Portal Groups, and delete a
// Portal, on real PostgreSQL with two organizations: the results a manager sees,
// the refusals, the facts recorded and the ledger written. The real use cases
// run over the real stores and command store; only the clock and ids are fixed.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { isPortalError } from '../domain/errors'
import { addPortalToGroup } from '../application/use-cases/add-portal-to-group'
import { createPortalGroup } from '../application/use-cases/create-portal-group'
import {
  listPortalGroupHistory,
  PORTAL_GROUP_HISTORY_PAGE,
} from '../application/use-cases/list-portal-group-history'
import { removePortalFromGroup } from '../application/use-cases/remove-portal-from-group'
import { softDeletePortal } from '../application/use-cases/soft-delete-portal'
import { softDeletePortalGroup } from '../application/use-cases/soft-delete-portal-group'
import { updatePortalGroup } from '../application/use-cases/update-portal-group'
import { issuePortalToken } from '../application/use-cases/issue-portal-token'
import { portalToRow } from '../infrastructure/mappers/portal.mapper'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalGroupRepository } from '../infrastructure/repositories/portal-group.repository'
import { createPortalGroupHistoryRepository } from '../infrastructure/repositories/portal-group-history.repository'
import { createPortalTokenRepository } from '../infrastructure/repositories/portal-token.repository'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-group-lifecycle-0000000000001')
const ORG_B = organizationId('org-group-lifecycle-0000000000002')
const MANAGER = userId('manager-group-lifecycle-000000001')
const NOW = new Date('2026-09-30T10:00:00.000Z')
const EARLIER = new Date('2026-09-01T10:00:00.000Z')
const NEXT = new Date(NOW.getTime() + 1)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    'outbox_events',
    'portal_responsible_managers',
    'portals',
    'properties',
  ],
})

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function wire(accessible: ReadonlyArray<PropertyId> | null = null) {
  const db = getDb()
  const propertyRepo = createPropertyRepository(db)
  const propertyApi = {
    propertyExists: async (org: OrganizationId, id: PropertyId) =>
      (await propertyRepo.findById(org, id)) !== null,
  } as unknown as PropertyPublicApi
  const common = {
    portalGroupRepo: createPortalGroupRepository(db),
    staffPublicApi: staffApi(accessible),
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    clock: () => NOW,
  }
  const portalRepo = createPortalRepository(db)
  return {
    create: createPortalGroup({
      ...common,
      portalRepo,
      propertyApi,
      idGen: () => portalGroupId(randomUUID()),
    }),
    update: updatePortalGroup(common),
    archive: softDeletePortalGroup(common),
    add: addPortalToGroup({ ...common, portalRepo }),
    remove: removePortalFromGroup(common),
    list: listPortalGroupHistory({
      portalGroupRepo: common.portalGroupRepo,
      portalGroupHistoryRepo: createPortalGroupHistoryRepository(db),
      staffPublicApi: common.staffPublicApi,
    }),
    deletePortal: softDeletePortal({ ...common, portalRepo }),
    issue: issuePortalToken({
      portalRepo,
      portalTokenRepo: createPortalTokenRepository(db),
      staffPublicApi: common.staffPublicApi,
      commandStore: common.commandStore,
      tokenCodec: testPortalTokenCodec(),
      addressCipher: null,
      reportPrintCodeProblem: () => undefined,
      idGen: randomUUID,
      clock: () => NOW,
      address: {
        appOrigin: 'https://app.example.test',
        printOrigin: 'https://ap.example.test',
      },
    }),
  }
}

const ctxOf = (
  org: OrganizationId,
  role: AuthContext['role'] = 'PropertyManager',
): AuthContext => buildTestAuthContext({ organizationId: org, userId: MANAGER, role })

const codeOf = (error: unknown): string | undefined =>
  isPortalError(error) ? error.code : undefined

async function seedProperty(org: OrganizationId): Promise<PropertyId> {
  const id = propertyId(randomUUID())
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Lifecycle property', $3, 'UTC', $4, $4)`,
    [id, org, `life-${id.slice(0, 8)}`, EARLIER],
  )
  return id
}

async function seedPortal(
  org: OrganizationId,
  property: PropertyId,
  overrides: Parameters<typeof buildTestPortal>[0] = {},
): Promise<PortalId> {
  const id = portalId(randomUUID())
  await getDb()
    .insert(portals)
    .values(
      portalToRow(
        buildTestPortal({
          id,
          organizationId: org,
          propertyId: property,
          entityId: property,
          name: `Portal ${id.slice(0, 8)}`,
          slug: `life-${id.slice(0, 8)}`,
          createdBy: MANAGER,
          createdAt: EARLIER,
          updatedAt: EARLIER,
          ...overrides,
        }),
      ),
    )
  return id
}

async function seedGroup(
  org: OrganizationId,
  property: PropertyId,
  name: string,
  updatedAt: Date = EARLIER,
): Promise<PortalGroupId> {
  const id = portalGroupId(randomUUID())
  await getPool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, org, property, name, updatedAt],
  )
  return id
}

async function seedMembership(
  org: OrganizationId,
  property: PropertyId,
  portal: PortalId,
  group: PortalGroupId,
) {
  await getPool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [org, property, portal, group, EARLIER, MANAGER],
  )
}

const groupRows = async (org: OrganizationId) =>
  (
    await getPool().query(
      `SELECT id, name, created_by, updated_at, deleted_at FROM portal_groups
       WHERE organization_id = $1 ORDER BY name`,
      [org],
    )
  ).rows

const membershipRows = async (org: OrganizationId, portal: PortalId) =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", effective_to, end_reason
       FROM portal_group_memberships WHERE organization_id = $1 AND portal_id = $2
       ORDER BY effective_from, portal_group_id`,
      [org, portal],
    )
  ).rows

const factsOf = async (org: OrganizationId, tag?: string) =>
  (
    await getPool().query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND ($2::text IS NULL OR event_type = $2)
       ORDER BY event_type`,
      [org, tag ?? null],
    )
  ).rows

const historyRows = async (org: OrganizationId) =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", kind, portal_id AS portal, name,
              previous_name AS previous, actor_user_id AS actor
       FROM portal_group_history WHERE organization_id = $1
       ORDER BY occurred_at, kind, portal_id NULLS FIRST, portal_group_id`,
      [org],
    )
  ).rows

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

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

    await expect(
      create({ name: 'Test', propertyId: property }, ctxOf(ORG_A, 'Member')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

    expect(await groupRows(ORG_A)).toEqual([])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a duplicate name in the same Property and allows it in another tenant', async () => {
    const property = await seedProperty(ORG_A)
    const otherTenantProperty = await seedProperty(ORG_B)
    const { create } = wire()
    await create({ name: 'My Group', propertyId: property }, ctxOf(ORG_A))

    await expect(
      create({ name: 'My Group', propertyId: property }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_name_taken')
    expect(await groupRows(ORG_A)).toHaveLength(1)

    await create({ name: 'My Group', propertyId: otherTenantProperty }, ctxOf(ORG_B))
    expect(await groupRows(ORG_B)).toHaveLength(1)
  })

  it('refuses a PropertyManager who is not assigned to the Property and allows an assigned one', async () => {
    const property = await seedProperty(ORG_A)

    await expect(
      wire([]).create({ name: 'Test', propertyId: property }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
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

    await expect(
      create({ name: 'Foreign', propertyId: propertyA }, ctxOf(ORG_B)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'property_not_found')
    await expect(
      create(
        { name: 'Foreign portal', propertyId: propertyB, portalIds: [portalA] },
        ctxOf(ORG_B),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')

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

    await expect(
      create(
        { name: 'New', propertyId: otherProperty, portalIds: [portals[0]] },
        ctxOf(ORG_A),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

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

    await expect(
      update({ portalGroupId: randomUUID(), name: 'New' }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
    await expect(
      update({ portalGroupId: group, name: 'Taken over' }, ctxOf(ORG_B)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ name: 'Old Name', updated_at: EARLIER }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('refuses a role without portal.update and a manager who is not assigned', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Old Name')

    await expect(
      wire().update({ portalGroupId: group, name: 'New' }, ctxOf(ORG_A, 'Member')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expect(
      wire([]).update({ portalGroupId: group, name: 'New' }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

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

    await expect(
      wire(null).archive({ portalGroupId: group }, ctxOf(ORG_A, 'Member')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses a PropertyManager, who is not granted portal.delete', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group')

    await expect(
      wire([]).archive({ portalGroupId: group }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
  })

  it('refuses a missing group and a group of another organization', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Test Group')
    const { archive } = wire(null)

    await expect(
      archive({ portalGroupId: randomUUID() }, ctxOf(ORG_A, 'AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
    await expect(
      archive({ portalGroupId: group }, ctxOf(ORG_B, 'AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')

    expect(await groupRows(ORG_A)).toEqual([
      expect.objectContaining({ deleted_at: null }),
    ])
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })
})

describe.sequential('listPortalGroupHistory (real PostgreSQL, two tenants)', () => {
  const readOnly = (org: OrganizationId) =>
    buildTestAuthContext({
      organizationId: org,
      userId: MANAGER,
      role: 'Member',
      effectivePermissions: new Set<Permission>(['dashboard.read']),
    })

  it('returns the ledger of a group, one page', async () => {
    const property = await seedProperty(ORG_A)
    const { create, list } = wire()
    const group = await create({ name: 'Lobby', propertyId: property }, ctxOf(ORG_A))

    const result = await list({ portalGroupId: group.id }, ctxOf(ORG_A))

    expect(result).toEqual([
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: property,
        portalGroupId: group.id,
        kind: 'created',
        portalId: null,
        otherGroupId: null,
        name: 'Lobby',
        previousName: null,
        actorUserId: MANAGER,
        occurredAt: NOW,
      }),
    ])
  })

  it('stops at one page of a longer ledger', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')
    await getPool().query(
      `INSERT INTO portal_group_history
         (organization_id, property_id, portal_group_id, kind, name, previous_name,
          actor_user_id, occurred_at)
       SELECT $1, $2, $3, 'renamed', 'Name ' || n, 'Name ' || (n - 1), $4,
              $5::timestamptz + n * interval '1 second'
       FROM generate_series(1, $6::int) AS n`,
      [ORG_A, property, group, MANAGER, EARLIER, PORTAL_GROUP_HISTORY_PAGE + 5],
    )

    const result = await wire().list({ portalGroupId: group }, ctxOf(ORG_A))

    expect(result).toHaveLength(PORTAL_GROUP_HISTORY_PAGE)
    expect(result[0]?.name).toBe(`Name ${PORTAL_GROUP_HISTORY_PAGE + 5}`)
  })

  it('refuses a role that cannot read Portals', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')

    await expect(
      wire().list({ portalGroupId: group }, readOnly(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
  })

  it('refuses a group that is not in the Organization', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')
    const { list } = wire()

    await expect(list({ portalGroupId: randomUUID() }, ctxOf(ORG_A))).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'group_not_found',
    )
    await expect(list({ portalGroupId: group }, ctxOf(ORG_B))).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'group_not_found',
    )
  })

  it('refuses a manager who is not assigned to the group Property', async () => {
    const property = await seedProperty(ORG_A)
    const group = await seedGroup(ORG_A, property, 'Lobby')

    await expect(wire([]).list({ portalGroupId: group }, ctxOf(ORG_A))).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'forbidden',
    )
  })
})

describe.sequential('softDeletePortal (real PostgreSQL, two tenants)', () => {
  const portalRow = async (org: OrganizationId, id: PortalId) =>
    (
      await getPool().query(
        `SELECT deleted_at, updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
        [org, id],
      )
    ).rows[0]

  const tokenRows = async (org: OrganizationId, id: PortalId) =>
    (
      await getPool().query(
        `SELECT status, revoked_by, revoked_reason, revoked_at FROM portal_tokens
         WHERE organization_id = $1 AND portal_id = $2`,
        [org, id],
      )
    ).rows

  it('requires staff removal for a personal Portal instead of ordinary deletion', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property, {
      kind: 'personal',
      publicName: 'Harbor',
    })

    await expect(
      wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin')),
    ).rejects.toMatchObject({ code: 'personal_portal_archive_locked' })

    expect(await factsOf(ORG_A)).toEqual([])
    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
  })

  it('soft-deletes a Portal and records the portal.deleted fact', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property, { updatedAt: NOW })

    await wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await portalRow(ORG_A, portal)).toMatchObject({
      deleted_at: NOW,
      updated_at: NEXT,
    })
    const emitted = await factsOf(ORG_A, 'portal.deleted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.payload).toMatchObject({
      portalId: portal,
      sourceAggregateVersion: NEXT.toISOString(),
    })
  })

  it('refuses a role that cannot delete', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)

    await expect(
      wire().deletePortal({ portalId: portal }, ctxOf(ORG_A)),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')

    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
    expect(await factsOf(ORG_A)).toEqual([])
  })

  it('refuses an unknown Portal and a Portal of another organization', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)
    const { deletePortal } = wire()

    await expect(
      deletePortal({ portalId: randomUUID() }, ctxOf(ORG_A, 'AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')
    await expect(
      deletePortal({ portalId: portal }, ctxOf(ORG_B, 'AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')

    expect((await portalRow(ORG_A, portal))?.deleted_at).toBeNull()
    expect(await factsOf(ORG_A)).toEqual([])
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('revokes the Portal tokens with an audit reason and leaves another tenant alone', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)
    const propertyB = await seedProperty(ORG_B)
    const portalB = await seedPortal(ORG_B, propertyB)
    const { issue, deletePortal } = wire()
    await issue({ portalId: portal }, ctxOf(ORG_A))
    await issue({ portalId: portalB }, ctxOf(ORG_B))
    await getPool().query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
      [ORG_A, ORG_B],
    ])

    await deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await tokenRows(ORG_A, portal)).toEqual([
      expect.objectContaining({
        status: 'revoked',
        revoked_by: MANAGER,
        revoked_reason: 'portal deleted',
        revoked_at: NOW,
      }),
    ])
    expect(await tokenRows(ORG_B, portalB)).toEqual([
      expect.objectContaining({ status: 'active', revoked_by: null }),
    ])
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toHaveLength(1)
    expect(await factsOf(ORG_B)).toEqual([])
  })

  it('stays quiet about tokens when the Portal has no live tokens', async () => {
    const property = await seedProperty(ORG_A)
    const portal = await seedPortal(ORG_A, property)

    await wire().deletePortal({ portalId: portal }, ctxOf(ORG_A, 'AccountAdmin'))

    expect(await tokenRows(ORG_A, portal)).toEqual([])
    expect(await factsOf(ORG_A, 'portal.token.revoked')).toEqual([])
    expect(await factsOf(ORG_A, 'portal.deleted')).toHaveLength(1)
  })
})
