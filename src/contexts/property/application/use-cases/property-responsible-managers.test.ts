import { describe, expect, it } from 'vitest'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import type { PropertyResponsibleManager } from '../../domain/property-responsible-manager'
import type { PropertyResponsibleManagerRepository } from '../ports/property-responsible-manager.repository'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './property-responsible-managers'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const PROPERTY = buildTestProperty({
  responsibleManagerRevision: 1,
  responsibilityNeededSince: NOW,
})

type Release = Parameters<PropertyResponsibleManagerRepository['releaseForUser']>[0]

/**
 * `removedWhileSaving`: members whose removal commits after the save has read
 * them as eligible and before its own write commits.
 */
const setup = (removedWhileSaving: readonly string[] = []) => {
  const propertyRepo = createInMemoryPropertyRepo()
  propertyRepo.seed([PROPERTY])
  const outbox = createRecordedOutbox()
  let active: PropertyResponsibleManager[] = []
  const gone = new Set<string>()
  const releases: Release[] = []
  const managerRepo: PropertyResponsibleManagerRepository = {
    listActive: async () => active,
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
        userId,
        effectiveFrom: input.at,
        effectiveTo: null,
        createdBy: input.actorId,
        endReason: null,
      }))
      const becameResponsibilityNeeded = hadManagers && active.length === 0
      if (becameResponsibilityNeeded) {
        await outbox.record(input.responsibilityNeededEvent)
      }
      return {
        assignments: active,
        revision: input.expectedRevision + 1,
        becameResponsibilityNeeded,
      }
    },
  }
  const deps = {
    propertyRepo,
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
        userId === 'manager-no-grant' ? [] : [PROPERTY.id],
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  }
  return { deps, outbox, releases, assigned: () => active.map((row) => row.userId) }
}

describe('Property Responsible Managers', () => {
  it('lists explicit assignments separately from eligible candidates', async () => {
    const { deps } = setup()
    const result = await listPropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(result.assignments).toEqual([])
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
    expect(result).toMatchObject({
      revision: 1,
      responsibilityNeeded: true,
      responsibilityNeededSince: NOW,
    })
  })

  it('supports multiple managers and rejects a manager without a current grant', async () => {
    const { deps } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await updatePropertyResponsibleManagers(deps)(
      {
        propertyId: PROPERTY.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      ctx,
    )
    expect(result.assignments.map((row) => row.userId)).toEqual(['admin-1', 'manager-1'])

    await expect(
      updatePropertyResponsibleManagers(deps)(
        {
          propertyId: PROPERTY.id,
          managerUserIds: ['manager-no-grant'],
          expectedRevision: 2,
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'responsible_manager_ineligible',
    })
  })

  it('releases a manager removed while the save committed, keeps the others and refuses the save', async () => {
    const { deps, releases, assigned } = setup(['manager-1'])

    await expect(
      updatePropertyResponsibleManagers(deps)(
        {
          propertyId: PROPERTY.id,
          managerUserIds: ['admin-1', 'manager-1'],
          expectedRevision: 1,
        },
        buildTestAuthContext({ role: 'AccountAdmin' }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'responsible_manager_ineligible',
    })

    expect(assigned()).toEqual(['admin-1'])
    expect(releases).toEqual([
      {
        organizationId: PROPERTY.organizationId,
        userId: 'manager-1',
        propertyIds: [PROPERTY.id],
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

    await updatePropertyResponsibleManagers(deps)(
      {
        propertyId: PROPERTY.id,
        managerUserIds: ['admin-1', 'manager-1'],
        expectedRevision: 1,
      },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(assigned()).toEqual(['admin-1', 'manager-1'])
    expect(releases).toEqual([])
  })

  it('records recovery only when an owned Property loses its last manager', async () => {
    const { deps, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: ['admin-1'], expectedRevision: 1 },
      ctx,
    )
    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: [], expectedRevision: 2 },
      ctx,
    )
    await updatePropertyResponsibleManagers(deps)(
      { propertyId: PROPERTY.id, managerUserIds: [], expectedRevision: 3 },
      ctx,
    )

    expect(outbox.byTag('property.responsibility_became_needed')).toEqual([
      expect.objectContaining({
        propertyId: PROPERTY.id,
        organizationId: PROPERTY.organizationId,
        occurredAt: NOW,
        // The admin who cleared the list is not asked to fix it (ADR 0046).
        actorUserId: ctx.userId,
      }),
    ])
  })
})
