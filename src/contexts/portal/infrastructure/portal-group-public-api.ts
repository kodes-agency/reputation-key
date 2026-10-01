// The Portal Group reads other contexts may make, built over the group repository.

import type { PortalGroupRepository } from '../application/ports/portal-group.repository'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'

export const createPortalGroupPublicApi = (
  portalGroupRepo: PortalGroupRepository,
  clock: () => Date,
) => ({
  findGroupForPortal: async (orgId: OrganizationId, pid: PortalId, asOf?: Date) => {
    const group = await portalGroupRepo.findGroupForPortal(orgId, pid, asOf ?? clock())
    if (!group) return null
    return { id: group.id, propertyId: group.propertyId, name: group.name }
  },
  getGroupPortalIds: (orgId: OrganizationId, groupId: PortalGroupId) =>
    portalGroupRepo.getGroupPortalIds(orgId, groupId),
  findGroupIdsByPortalIds: (orgId: OrganizationId, portalIds: ReadonlyArray<PortalId>) =>
    portalGroupRepo.findGroupIdsByPortalIds(orgId, portalIds),
  portalGroupBelongsToProperty: async (
    orgId: OrganizationId,
    pid: PropertyId,
    groupId: PortalGroupId,
  ) => {
    const group = await portalGroupRepo.findById(orgId, groupId)
    return group?.propertyId === pid
  },
})
