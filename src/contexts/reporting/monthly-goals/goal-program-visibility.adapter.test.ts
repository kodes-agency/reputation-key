import { describe, expect, it, vi } from 'vitest'
import { portalGroupId, portalId } from '#/shared/domain/ids'
import { createGoalProgramVisibilityAdapter } from './goal-program-visibility.adapter.server'

describe('Goal Program visibility adapter', () => {
  it("resolves the actor's responsible Portals, then their groups, in the actor's tenant", async () => {
    const portalIds = [portalId('portal-1'), portalId('portal-2')]
    const groupIds = [portalGroupId('group-1')]
    const staffApi = { getAssignedPortals: vi.fn(async () => portalIds) }
    const portalGroupApi = { findGroupIdsByPortalIds: vi.fn(async () => groupIds) }
    const actor = {
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'PropertyManager' as const,
      effectivePermissions: new Set(['goal.read'] as const),
    }

    await expect(
      createGoalProgramVisibilityAdapter(
        staffApi,
        portalGroupApi,
      )({ actor, propertyId: 'property-1' }),
    ).resolves.toEqual({ portalIds, groupIds })
    expect(staffApi.getAssignedPortals).toHaveBeenCalledWith(
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
