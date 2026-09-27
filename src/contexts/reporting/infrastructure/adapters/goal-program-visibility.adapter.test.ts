import { describe, expect, it, vi } from 'vitest'
import { portalGroupId, portalId } from '#/shared/domain/ids'
import type { StaffPortalResolverPort } from '../../application/ports/staff-portal-resolver.port'
import { createGoalProgramVisibilityAdapter } from './goal-program-visibility.adapter'

describe('Goal Program visibility adapter', () => {
  it("resolves the actor's responsible Portals, then their groups, in the actor's tenant", async () => {
    const portalIds = [portalId('portal-1'), portalId('portal-2')]
    const groupIds = [portalGroupId('group-1')]
    const resolveAssignedPortals = vi.fn<StaffPortalResolverPort>(async () => portalIds)
    const portalGroupApi = { findGroupIdsByPortalIds: vi.fn(async () => groupIds) }
    const actor = {
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'PropertyManager' as const,
      effectivePermissions: new Set(['goal.read'] as const),
    }

    await expect(
      createGoalProgramVisibilityAdapter(
        resolveAssignedPortals,
        portalGroupApi,
      )({ actor, propertyId: 'property-1' }),
    ).resolves.toEqual({ portalIds, groupIds })
    expect(resolveAssignedPortals).toHaveBeenCalledWith(
      { userId: 'user-1', propertyId: 'property-1' },
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'PropertyManager',
        effectivePermissions: actor.effectivePermissions,
      }),
    )
    expect(portalGroupApi.findGroupIdsByPortalIds).toHaveBeenCalledWith(
      'org-1',
      portalIds,
    )
  })
})
