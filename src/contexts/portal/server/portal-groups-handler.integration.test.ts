// Portal context — the group server functions over PostgreSQL.
// The real createServerFn handlers run over the real scope lookups, the real
// use cases and the real command store. The session and the execution policy
// are the answers of other contexts, so they are stood in for; each refusal is
// asserted on the rows it leaves.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId, portalGroupId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { policyDenial } from '#/shared/testing/policy-denial'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { createAtomicPortalCommandStore } from '../publication/portal-command-store.server'
import { movePortalToGroup as movePortalToGroupUseCase } from '../application/use-cases/move-portal-to-group'
import { listPortalGroupHistory as listPortalGroupHistoryUseCase } from '../application/use-cases/list-portal-group-history'
import { createPortalScopeRepository } from '../infrastructure/repositories/portal-scope.repository'
import { createPortalGroupRepository } from '../infrastructure/repositories/portal-group.repository'
import { createPortalGroupHistoryRepository } from '../infrastructure/repositories/portal-group-history.repository'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  linkTenant,
  realLinkDeps,
  rowsOf,
  seedLinkTenant,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const handlerWorld = vi.hoisted(() => ({
  actor: undefined as unknown,
  requireExecutionAllowed: vi.fn(),
  management: (): unknown => undefined,
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => handlerWorld.actor),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: handlerWorld.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: { management: handlerWorld.management() },
  }),
}))

import { listPortalGroupHistory, movePortalToGroup } from './portal-groups'

const ORG_A = organizationId('org-grphandler-0000-0000-000000000001')
const ORG_B = organizationId('org-grphandler-0000-0000-000000000002')
const A = linkTenant('b8e50001', ORG_A)
const A_OTHER_PROPERTY = linkTenant('b8e50003', ORG_A)
const B = linkTenant('b8e50002', ORG_B)
const CLOCK = new Date('2026-11-01T12:00:00.000Z')
const GROUP_A = portalGroupId('b8e50001-0000-4000-8000-0000000000a1')
const GROUP_A2 = portalGroupId('b8e50003-0000-4000-8000-0000000000a2')
const GROUP_B = portalGroupId('b8e50002-0000-4000-8000-0000000000b1')

bindLinkWorld({
  commandStore: () =>
    createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard()),
  buildPortal: buildTestPortal,
  buildAuthContext: buildTestAuthContext,
})

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_group_history',
    'portal_group_memberships',
    'portal_groups',
    ...LINK_WORLD_TABLES,
  ],
})

handlerWorld.management = () => {
  const scopes = createPortalScopeRepository(getDb())
  const deps = {
    ...realLinkDeps({ clock: () => CLOCK }),
    portalGroupRepo: createPortalGroupRepository(getDb()),
    portalGroupHistoryRepo: createPortalGroupHistoryRepository(getDb()),
  }
  return {
    resolvePortalManagementScope: scopes.resolvePortal,
    resolvePortalGroupManagementScope: scopes.resolveGroup,
    movePortalToGroup: movePortalToGroupUseCase(deps),
    listPortalGroupHistory: listPortalGroupHistoryUseCase(deps),
  }
}

const seedGroup = (tenant: typeof A, id: string) =>
  getPool().query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, tenant.organizationId, tenant.propertyId, `Group ${id.slice(-2)}`, CLOCK],
  )

const memberships = () =>
  rowsOf<{ portal_id: string; portal_group_id: string }>(
    getPool(),
    `SELECT portal_id, portal_group_id FROM portal_group_memberships
      WHERE organization_id = ANY($1) AND effective_to IS NULL ORDER BY portal_id`,
    [[ORG_A, ORG_B]],
  )

const move = (portalGroupId: string, portalId: string) =>
  withStartContext(() => movePortalToGroup({ data: { portalGroupId, portalId } }))

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  handlerWorld.actor = tenantContext(A, 'AccountAdmin')
  handlerWorld.requireExecutionAllowed.mockReset()
  handlerWorld.requireExecutionAllowed.mockResolvedValue(undefined)
  await seedLinkTenant(getPool(), A)
  await seedLinkTenant(getPool(), A_OTHER_PROPERTY)
  await seedLinkTenant(getPool(), B)
  await seedGroup(A, GROUP_A)
  await seedGroup(A_OTHER_PROPERTY, GROUP_A2)
  await seedGroup(B, GROUP_B)
})

describe('movePortalToGroup server function (real PostgreSQL)', () => {
  it('puts the Portal in the group once the policy admits the caller on the Property', async () => {
    await move(GROUP_A, A.portalId)

    expect(await memberships()).toEqual([
      { portal_id: A.portalId, portal_group_id: GROUP_A },
    ])
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: handlerWorld.actor,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: A.propertyId,
    })
  })

  it('does not move a Portal that sits in another Property than the group', async () => {
    await expect(move(GROUP_A, A_OTHER_PROPERTY.portalId)).rejects.toMatchObject({
      name: 'PortalError',
      code: 'portal_not_in_group',
      status: 404,
    })

    expect(await memberships()).toEqual([])
  })

  it("does not move a Portal into another organization's group", async () => {
    await expect(move(GROUP_B, A.portalId)).rejects.toMatchObject({
      name: 'PortalError',
      status: 404,
    })

    expect(await memberships()).toEqual([])
  })

  it('does not move anything when the Property is not allowed to be written', async () => {
    handlerWorld.requireExecutionAllowed.mockRejectedValue(
      policyDenial('capability_disabled'),
    )

    await expect(move(GROUP_A, A.portalId)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await memberships()).toEqual([])
  })
})

describe('listPortalGroupHistory server function (real PostgreSQL)', () => {
  const read = (portalGroupId: string) =>
    withStartContext(() => listPortalGroupHistory({ data: { portalGroupId } }))

  it('reads the ledger of a group the caller may read, which a move has written', async () => {
    await move(GROUP_A, A.portalId)
    handlerWorld.requireExecutionAllowed.mockClear()

    await read(GROUP_A)

    const ledger = await rowsOf(
      getPool(),
      `SELECT 1 FROM portal_group_history WHERE organization_id = $1 AND portal_group_id = $2`,
      [ORG_A, GROUP_A],
    )
    expect(ledger).toHaveLength(1)
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: handlerWorld.actor,
      action: 'portal.read',
      capability: 'portal.read',
      propertyId: A.propertyId,
    })
  })

  it('answers not found for a group of another organization, without asking the policy', async () => {
    await expect(read(GROUP_B)).rejects.toMatchObject({
      name: 'PortalError',
      code: 'group_not_found',
      status: 404,
    })
    expect(handlerWorld.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})
