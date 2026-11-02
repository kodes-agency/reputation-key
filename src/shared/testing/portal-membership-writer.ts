import type { OrganizationId, PortalGroupId, PortalId } from '#/shared/domain/ids'
export type PortalMembershipWriter = Readonly<{
  writeMembership: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
    portalId: PortalId,
    at: Date,
    createdBy: string,
  ) => Promise<void>
}>
