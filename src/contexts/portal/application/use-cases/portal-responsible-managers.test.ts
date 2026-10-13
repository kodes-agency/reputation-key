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

type Release = Parameters<PortalResponsibleManagerRepository['releaseForUser']>[0]

/**
 * `removedWhileSaving`: members whose removal commits after the save has read
 * them as eligible and before its own write commits.
 */
const setup = (removedWhileSaving: readonly string[] = []) => {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([PORTAL])
  const gone = new Set<string>()
  const releases: Release[] = []
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
    listActiveForPortals: async (_organizationId, portalIds) =>
      active.filter((row) => portalIds.includes(row.portalId)),
    listActiveForUser: async () => active,
    releaseForUser: async (input) => {
      releases.push(input)
      const kept = active.filter((row) => row.userId !== input.userId)
      const released = active.length - kept.length
      active = kept
      return { released }
    },
    replace: async (input) => {
      removedWhileSaving.forEach((userId) => gone.add(userId))
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
      listActiveManagers: async () =>
        [
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
            userId: 'manager-no-grant',
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
        ].filter((member) => !gone.has(member.userId)),
    },
    staffPublicApi: {
      getAccessiblePropertyIds: async (_org: string, userId: string) =>
        userId === 'manager-no-grant' ? [] : [PORTAL.propertyId],
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  }
  return { deps, managerRepo, releases, assigned: () => active.map((row) => row.userId) }
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

  it('rejects a manager without a current grant for the Property', async () => {
    const { deps } = setup()
    await expect(
      updatePortalResponsibleManagers(deps)(
        {
          portalId: PORTAL.id,
          managerUserIds: ['manager-no-grant'],
          expectedRevision: 1,
        },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'responsible_manager_ineligible',
    })
  })

  it('releases a manager removed while the save committed, keeps the others and refuses the save', async () => {
    const { deps, releases, assigned } = setup(['manager-1'])

    await expect(
      updatePortalResponsibleManagers(deps)(
        {
          portalId: PORTAL.id,
          managerUserIds: ['admin-1', 'manager-1'],
          expectedRevision: 1,
        },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'responsible_manager_ineligible',
    })

    expect(assigned()).toEqual(['admin-1'])
    expect(releases).toEqual([
      {
        organizationId: PORTAL.organizationId,
        userId: 'manager-1',
        portalIds: [PORTAL.id],
        // The clock has not moved since the assignment: an interval ends
        // after it began.
        at: new Date(NOW.getTime() + 1),
        endReason: 'manager_became_ineligible',
        // Nobody chose this gap, so nobody is left out of its notice.
        actorId: null,
      },
    ])
  })

  it('releases nobody when every assigned manager is still eligible after the commit', async () => {
    const { deps, releases, assigned } = setup()

    await updatePortalResponsibleManagers(deps)(
      {
        portalId: PORTAL.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(assigned()).toEqual(['admin-1', 'manager-1'])
    expect(releases).toEqual([])
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
