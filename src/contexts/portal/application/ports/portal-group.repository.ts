// Portal context — PortalGroup repository port
import type { PortalGroup } from '../../domain/types'
import type { OrganizationId, PortalGroupId, PropertyId } from '#/shared/domain/ids'

export type PortalGroupRepository = Readonly<{
  findById(orgId: OrganizationId, id: PortalGroupId): Promise<PortalGroup | null>
  listByProperty(
    orgId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<ReadonlyArray<PortalGroup>>
  findByNameDuplicate(
    orgId: OrganizationId,
    propertyId: PropertyId,
    name: string,
    excludeId?: PortalGroupId,
  ): Promise<PortalGroup | null>
  insert(group: PortalGroup): Promise<PortalGroup>
  update(group: PortalGroup): Promise<PortalGroup>
  delete(orgId: OrganizationId, id: PortalGroupId): Promise<void>
}>
