import { describe, expect, it } from 'vitest'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { PortalResponsibleManagerRepository } from '../ports/portal-responsible-manager.repository'
import type { PortalResponsibleManager } from '../../domain/portal-responsible-manager'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './portal-responsible-managers'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const PORTAL = buildTestPortal({ responsibleManagerRevision: 1 })

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([PORTAL])
  let active: PortalResponsibleManager[] = [
    {
      id: 'assignment-1',
      organizationId: PORTAL.organizationId,
      propertyId: PORTAL.propertyId,
      portalId: PORTAL.id,
      userId: 'admin-1',
      effectiveFrom: NOW,
      effectiveTo: null,
      createdBy: 'creator-1',
      endReason: null,
    },
  ]
  const managerRepo: PortalResponsibleManagerRepository = {
    listActive: async () => active,
    listActiveForUser: async () => active,
    releaseForUser: async () => ({ released: 0 }),
    replace: async (input) => {
      const hadManagers = active.length > 0
      active = input.managerUserIds.map((userId, index) => ({
        id: `assignment-${index + 1}`,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        portalId: input.portalId,
        userId,
        effectiveFrom: input.at,
        effectiveTo: null,
        createdBy: input.actorId,
        endReason: null,
      }))
      return {
        assignments: active,
        revision: input.expectedRevision + 1,
        becameResponsibilityNeeded: hadManagers && active.length === 0,
      }
    },
  }
  const deps = {
    portalRepo,
    managerRepo,
    identityPublicApi: {
      listActiveManagers: async () => [
        {
          userId: 'admin-1',
          role: 'AccountAdmin' as const,
          propertyAccessScope: 'organization' as const,
        },
        {
          userId: 'manager-1',
          role: 'PropertyManager' as const,
          propertyAccessScope: 'assigned-properties' as const,
        },
        {
          userId: 'manager-ineligible',
          role: 'PropertyManager' as const,
          propertyAccessScope: 'assigned-properties' as const,
        },
      ],
    },
    staffPublicApi: {
      getAccessiblePropertyIds: async (_org: string, userId: string) =>
        userId === 'manager-ineligible' ? [] : [PORTAL.propertyId],
      getAssignedPortals: async () => [],
      findActiveParticipation: async (_org: string, _property: string, userId: string) =>
        userId === 'manager-ineligible' ? null : ({} as never),
    },
    clock: () => NOW,
  }
  return { deps, managerRepo }
}

describe('Portal Responsible Managers', () => {
  it('lists assignments separately from the eligible manager candidates', async () => {
    const { deps } = setup()
    const result = await listPortalResponsibleManagers(deps)(
      { portalId: PORTAL.id },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.assignments.map((row) => row.userId)).toEqual(['admin-1'])
    expect(result.eligibleManagers).toEqual([
      {
        userId: 'admin-1',
        role: 'AccountAdmin',
        propertyAccessScope: 'organization',
      },
      {
        userId: 'manager-1',
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
    ])
    expect(result.revision).toBe(1)
    expect(result.responsibilityNeeded).toBe(false)
  })

  it('supports multiple assigned managers without granting access', async () => {
    const { deps } = setup()
    const result = await updatePortalResponsibleManagers(deps)(
      {
        portalId: PORTAL.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.assignments.map((row) => row.userId)).toEqual(['admin-1', 'manager-1'])
    expect(result).toMatchObject({
      revision: 2,
      becameResponsibilityNeeded: false,
    })
  })

  it('rejects a manager who lacks the role-specific property eligibility', async () => {
    const { deps } = setup()
    await expect(
      updatePortalResponsibleManagers(deps)(
        {
          portalId: PORTAL.id,
          managerUserIds: ['manager-ineligible'],
          expectedRevision: 1,
        },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'responsible_manager_ineligible',
    })
  })

  it('reports the transition only when the last manager is removed', async () => {
    const { deps } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const first = await updatePortalResponsibleManagers(deps)(
      { portalId: PORTAL.id, managerUserIds: [], expectedRevision: 1 },
      ctx,
    )
    const second = await updatePortalResponsibleManagers(deps)(
      { portalId: PORTAL.id, managerUserIds: [], expectedRevision: 2 },
      ctx,
    )

    expect(first.becameResponsibilityNeeded).toBe(true)
    expect(second.becameResponsibilityNeeded).toBe(false)
  })
})
