// Portal context — get portal group use case tests
// Covers: portal.read authorization, organization-scoped lookup, the D6-001
// Property grant check, and the returned membership.

import { describe, it, expect, vi } from 'vitest'
import { getPortalGroup } from './get-portal-group'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import type { PortalGroupRepository } from '../ports/portal-group.repository'
import type { PortalGroup } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const GROUP_ID = portalGroupId('pg-00000000-0000-0000-0000-000000000001')
const PROPERTY_ID = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY_ID = propertyId('a0000000-0000-0000-0000-000000000002')
const MEMBER_PORTAL_IDS = [
  portalId('b0000000-0000-0000-0000-000000000001'),
  portalId('b0000000-0000-0000-0000-000000000002'),
]

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  // null simulates AccountAdmin org-wide bypass; an array simulates PM scoping.
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const groupOwnedBy = (orgId: PortalGroup['organizationId']): PortalGroup => ({
  id: GROUP_ID,
  organizationId: orgId,
  propertyId: PROPERTY_ID,
  name: 'Terrace',
  sortKey: null,
  createdBy: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
  deletedAt: null,
})

const setup = (group: PortalGroup, accessible: ReadonlyArray<PropertyId> | null) => {
  const getGroupPortalIds = vi.fn(async () => MEMBER_PORTAL_IDS)
  const portalGroupRepo: PortalGroupRepository = {
    // Organization-scoped, like the real repository.
    findById: async (orgId, id) =>
      group.organizationId === orgId && group.id === id ? group : null,
    getGroupPortalIds,
    listByProperty: async () => [],
    nameExists: async () => false,
    insert: async () => {},
    update: async () => {},
    softDelete: async () => {},
    addPortal: async () => {},
    removePortal: async () => false,
    findPortalMembership: async () => null,
    findGroupIdsByPortalIds: async () => [],
    listGroupsForPortals: async () => [],
    listPortalGroupsWithPortals: async () => [],
    findGroupForPortal: async () => null,
  }
  const useCase = getPortalGroup({
    portalGroupRepo,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, getGroupPortalIds }
}

describe('getPortalGroup', () => {
  it('returns the group and its portals to a PropertyManager granted its Property', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const group = groupOwnedBy(ctx.organizationId)
    const { useCase, getGroupPortalIds } = setup(group, [PROPERTY_ID])

    const result = await useCase({ portalGroupId: String(GROUP_ID) }, ctx)

    expect(result).toEqual({ ...group, portalIds: MEMBER_PORTAL_IDS })
    expect(getGroupPortalIds).toHaveBeenCalledWith(ctx.organizationId, GROUP_ID)
  })

  it('rejects a caller without portal.read', async () => {
    const ctx = buildTestAuthContext({
      role: 'Member',
      effectivePermissions: new Set<Permission>(['dashboard.read']),
    })
    const { useCase } = setup(groupOwnedBy(ctx.organizationId), null)

    await expect(useCase({ portalGroupId: String(GROUP_ID) }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects group_not_found for a group owned by another organization', async () => {
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const { useCase } = setup(groupOwnedBy(organizationId('org-another-tenant')), null)

    await expect(useCase({ portalGroupId: String(GROUP_ID) }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'group_not_found',
    )
  })

  it('rejects a PropertyManager whose grants exclude the group Property', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const { useCase, getGroupPortalIds } = setup(groupOwnedBy(ctx.organizationId), [
      OTHER_PROPERTY_ID,
    ])

    await expect(useCase({ portalGroupId: String(GROUP_ID) }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
    expect(getGroupPortalIds).not.toHaveBeenCalled()
  })
})
