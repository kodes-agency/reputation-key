import type { StaffParticipation } from '../domain/staff-participation'
import type { PortalResponsibility } from '../domain/portal-responsibility'

export type StaffParticipationRepository = Readonly<{
  findActiveByUser: (
    organizationId: string,
    propertyId: string,
    userId: string,
  ) => Promise<StaffParticipation | null>
  listActiveResponsibilities: (
    organizationId: string,
    staffParticipationId: string,
  ) => Promise<readonly PortalResponsibility[]>
}>
