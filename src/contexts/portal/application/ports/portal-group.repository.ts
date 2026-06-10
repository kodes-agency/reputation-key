// Portal context — portal group repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { PortalGroup } from '../../domain/types'
import type {
  OrganizationId,
  PropertyId,
  PortalGroupId,
  PortalId,
} from '#/shared/domain/ids'

export type PortalGroupWithPortals = Readonly<{
  group: PortalGroup
  portalIds: ReadonlyArray<PortalId>
}>

export type PortalGroupRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PortalGroupId) => Promise<PortalGroup | null>
  listByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<PortalGroup>>
  nameExists: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    name: string,
    excludeId?: PortalGroupId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, group: PortalGroup) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: PortalGroupId,
    patch: Readonly<Partial<Pick<PortalGroup, 'name' | 'sortKey' | 'updatedAt'>>>,
  ) => Promise<void>
  softDelete: (orgId: OrganizationId, id: PortalGroupId) => Promise<void>
  addPortal: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
    portalId: PortalId,
  ) => Promise<void>
  removePortal: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
    portalId: PortalId,
  ) => Promise<boolean>
  findPortalMembership: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalGroupId | null>
  getGroupPortalIds: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
  ) => Promise<ReadonlyArray<PortalId>>
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<PortalGroup | null>
}>
