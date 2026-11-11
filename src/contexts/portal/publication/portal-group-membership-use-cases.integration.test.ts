// The Portal Group membership use cases over the real repositories and the
// atomic command store on PostgreSQL: a refusal must leave the memberships,
// group revisions and outbox untouched, which in-memory doubles cannot show.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { isPortalError } from '../domain/errors'
import { portalCreated } from '../domain/events'
import { addPortalToGroup } from '../application/use-cases/add-portal-to-group'
import { removePortalFromGroup } from '../application/use-cases/remove-portal-from-group'
import { movePortalToGroup } from '../application/use-cases/move-portal-to-group'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import { createPortalGroupRepository } from '../infrastructure/repositories/portal-group.repository'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG_A = organizationId('org-groupuse-0000-0000000000000001')
const ORG_B = organizationId('org-groupuse-0000-0000000000000002')
const PROPERTY = propertyId('8a000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('8a000000-0000-4000-8000-000000000002')
const PORTAL = portalId('8b000000-0000-4000-8000-000000000001')
const GROUP_A = portalGroupId('8f000000-0000-4000-8000-00000000000a')
const GROUP_B = portalGroupId('8f000000-0000-4000-8000-00000000000b')
const GROUP_OTHER = portalGroupId('8f000000-0000-4000-8000-00000000000c')
const MANAGER = userId('manager-groupuse-000000000000001')
const SEEDED_AT = new Date('2026-09-01T10:00:00.000Z')
const NOW = new Date('2026-09-30T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
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

function deps(accessible: ReadonlyArray<PropertyId> | null = [PROPERTY]) {
  const db = getDb()
  return {
    portalGroupRepo: createPortalGroupRepository(db),
    portalRepo: createPortalRepository(db),
    staffPublicApi: staffApi(accessible),
    commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    clock: () => NOW,
  }
}

const manager = (overrides: Partial<AuthContext> = {}): AuthContext =>
  buildTestAuthContext({
    organizationId: ORG_A,
    userId: MANAGER,
    role: 'PropertyManager',
    ...overrides,
  })

const codeOf = (error: unknown): string | undefined =>
  isPortalError(error) ? error.code : undefined

async function seedGroup(id: PortalGroupId, property: PropertyId, name: string) {
  await getPool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, ORG_A, property, name, SEEDED_AT],
  )
}

async function seedMembership(portal: PortalId, group: PortalGroupId) {
  await getPool().query(
    `INSERT INTO portal_group_memberships
       (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ORG_A, PROPERTY, portal, group, SEEDED_AT, MANAGER],
  )
}

const openMemberships = async () =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group" FROM portal_group_memberships
       WHERE organization_id = $1 AND portal_id = $2 AND effective_to IS NULL`,
      [ORG_A, PORTAL],
    )
  ).rows.map((row) => row.group)

const allMemberships = async () =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", effective_to, end_reason, created_by
       FROM portal_group_memberships WHERE organization_id = $1 AND portal_id = $2
       ORDER BY effective_from, portal_group_id`,
      [ORG_A, PORTAL],
    )
  ).rows

const groupFacts = async () =>
  (
    await getPool().query(
      `SELECT event_type, payload->>'portalGroupId' AS group_id,
              payload->>'portalId' AS portal_id, payload->>'propertyId' AS property_id
       FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'portal_group.portal_%'
       ORDER BY event_type, payload->>'portalGroupId'`,
      [ORG_A],
    )
  ).rows

const historyKinds = async () =>
  (
    await getPool().query(
      `SELECT portal_group_id AS "group", kind, other_group_id AS other, actor_user_id
       FROM portal_group_history WHERE organization_id = $1
       ORDER BY portal_group_id, kind`,
      [ORG_A],
    )
  ).rows

const revisionOf = async (group: PortalGroupId) =>
  (
    await getPool().query(
      `SELECT updated_at FROM portal_groups WHERE organization_id = $1 AND id = $2`,
      [ORG_A, group],
    )
  ).rows[0]?.updated_at

async function expectNothingWritten(
  group: PortalGroupId,
  memberships: ReadonlyArray<PortalGroupId>,
) {
  expect(await openMemberships()).toEqual(memberships)
  expect(await groupFacts()).toEqual([])
  expect(await historyKinds()).toEqual([])
  expect(await revisionOf(group)).toEqual(SEEDED_AT)
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const pool = getPool()
  for (const [id, slug] of [
    [PROPERTY, 'group-use-property'],
    [OTHER_PROPERTY, 'group-use-other'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
      [id, ORG_A, slug, SEEDED_AT],
    )
  }
  const portal = buildTestPortal({
    id: PORTAL,
    organizationId: ORG_A,
    propertyId: PROPERTY,
    entityId: PROPERTY,
    name: 'lobby',
    slug: 'lobby',
    createdBy: MANAGER,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  })
  await createAtomicPortalCommandStore(
    getDb(),
    createPortalRatingGoalGuard(),
  ).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
  await pool.query(`DELETE FROM outbox_events WHERE organization_id = $1`, [ORG_A])
  await seedGroup(GROUP_A, PROPERTY, 'Group A')
  await seedGroup(GROUP_B, PROPERTY, 'Group B')
  await seedGroup(GROUP_OTHER, OTHER_PROPERTY, 'Group Other')
})

const input = (group: PortalGroupId) => ({ portalGroupId: group, portalId: PORTAL })

describe.sequential('addPortalToGroup (real PostgreSQL)', () => {
  it('adds an ungrouped Portal and records the fact and the history', async () => {
    await addPortalToGroup(deps())(input(GROUP_A), manager())

    expect(await openMemberships()).toEqual([GROUP_A])
    expect(await groupFacts()).toEqual([
      {
        event_type: 'portal_group.portal_added',
        group_id: GROUP_A,
        portal_id: PORTAL,
        property_id: PROPERTY,
      },
    ])
    expect(await historyKinds()).toEqual([
      { group: GROUP_A, kind: 'portal_added', other: null, actor_user_id: MANAGER },
    ])
    expect(await revisionOf(GROUP_A)).toEqual(NOW)
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    await expect(addPortalToGroup(deps([]))(input(GROUP_A), manager())).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'forbidden',
    )
    await expectNothingWritten(GROUP_A, [])
  })

  it('refuses a role that cannot update Portals', async () => {
    await expect(
      addPortalToGroup(deps())(input(GROUP_A), manager({ role: 'Member' })),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_A, [])
  })

  it('refuses a missing group and a missing Portal', async () => {
    await expect(
      addPortalToGroup(deps())(
        { portalGroupId: '8f000000-0000-4000-8000-0000000000ee', portalId: PORTAL },
        manager(),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
    await expect(
      addPortalToGroup(deps())(
        { portalGroupId: GROUP_A, portalId: '8b000000-0000-4000-8000-0000000000ee' },
        manager(),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')
    await expectNothingWritten(GROUP_A, [])
  })

  it('refuses a Portal that already has a group', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await expect(addPortalToGroup(deps())(input(GROUP_B), manager())).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'portal_already_grouped',
    )
    await expectNothingWritten(GROUP_B, [GROUP_A])
  })

  it("refuses a group of another Property than the Portal's", async () => {
    await expect(
      addPortalToGroup(deps([PROPERTY, OTHER_PROPERTY]))(input(GROUP_OTHER), manager()),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    expect(await openMemberships()).toEqual([])
    expect(await groupFacts()).toEqual([])
  })
})

describe.sequential('removePortalFromGroup (real PostgreSQL)', () => {
  it('ends the membership and records the fact and the history', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await removePortalFromGroup(deps())(input(GROUP_A), manager())

    expect(await openMemberships()).toEqual([])
    expect(await groupFacts()).toEqual([
      {
        event_type: 'portal_group.portal_removed',
        group_id: GROUP_A,
        portal_id: PORTAL,
        property_id: PROPERTY,
      },
    ])
    expect((await historyKinds()).map((row) => row.kind)).toEqual(['portal_removed'])
    expect(await revisionOf(GROUP_A)).toEqual(NOW)
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await expect(
      removePortalFromGroup(deps([]))(input(GROUP_A), manager()),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_A, [GROUP_A])
  })

  it('refuses a role that cannot update Portals', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await expect(
      removePortalFromGroup(deps())(input(GROUP_A), manager({ role: 'Member' })),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_A, [GROUP_A])
  })

  it('refuses a missing group', async () => {
    await expect(
      removePortalFromGroup(deps())(
        { portalGroupId: '8f000000-0000-4000-8000-0000000000ee', portalId: PORTAL },
        manager(),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
  })

  it('refuses a Portal that is not a member', async () => {
    await expect(
      removePortalFromGroup(deps())(input(GROUP_A), manager()),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_in_group')
    await expectNothingWritten(GROUP_A, [])
  })
})

describe.sequential('movePortalToGroup (real PostgreSQL)', () => {
  it('ends the old membership, begins the new one and records both sides', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await movePortalToGroup(deps())(input(GROUP_B), manager())

    expect(await allMemberships()).toEqual([
      {
        group: GROUP_A,
        effective_to: NOW,
        end_reason: 'moved_to_group',
        created_by: MANAGER,
      },
      { group: GROUP_B, effective_to: null, end_reason: null, created_by: MANAGER },
    ])
    expect(await groupFacts()).toEqual([
      expect.objectContaining({
        event_type: 'portal_group.portal_added',
        group_id: GROUP_B,
      }),
      expect.objectContaining({
        event_type: 'portal_group.portal_removed',
        group_id: GROUP_A,
      }),
    ])
    expect(await historyKinds()).toEqual([
      {
        group: GROUP_A,
        kind: 'portal_moved_out',
        other: GROUP_B,
        actor_user_id: MANAGER,
      },
      { group: GROUP_B, kind: 'portal_moved_in', other: GROUP_A, actor_user_id: MANAGER },
    ])
    expect(await revisionOf(GROUP_A)).toEqual(NOW)
    expect(await revisionOf(GROUP_B)).toEqual(NOW)
  })

  it('is a plain addition when the Portal has no group', async () => {
    await movePortalToGroup(deps())(input(GROUP_B), manager())

    expect(await openMemberships()).toEqual([GROUP_B])
    expect((await groupFacts()).map((row) => row.event_type)).toEqual([
      'portal_group.portal_added',
    ])
    expect((await historyKinds()).map((row) => row.kind)).toEqual(['portal_added'])
  })

  it('refuses a Portal that is already in the target group', async () => {
    await seedMembership(PORTAL, GROUP_B)

    await expect(movePortalToGroup(deps())(input(GROUP_B), manager())).rejects.toSatisfy(
      (e: unknown) => codeOf(e) === 'portal_already_grouped',
    )
    await expectNothingWritten(GROUP_B, [GROUP_B])
  })

  it('refuses a group in another Property and leaves the membership alone', async () => {
    await seedMembership(PORTAL, GROUP_A)

    await expect(
      movePortalToGroup(deps([PROPERTY, OTHER_PROPERTY]))(input(GROUP_OTHER), manager()),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_A, [GROUP_A])
  })

  it('refuses a missing group and a missing Portal', async () => {
    await expect(
      movePortalToGroup(deps())(
        { portalGroupId: '8f000000-0000-4000-8000-0000000000ee', portalId: PORTAL },
        manager(),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
    await expect(
      movePortalToGroup(deps())(
        { portalGroupId: GROUP_B, portalId: '8b000000-0000-4000-8000-0000000000ee' },
        manager(),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')
  })

  it('refuses a role that cannot update Portals', async () => {
    await expect(
      movePortalToGroup(deps())(input(GROUP_B), manager({ role: 'Member' })),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_B, [])
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    await expect(
      movePortalToGroup(deps([]))(input(GROUP_B), manager()),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    await expectNothingWritten(GROUP_B, [])
  })
})
