import type { StaffParticipation } from '../../domain/staff-participation'
import type {
  PortalResponsibility,
  ResponsibilityKind,
} from '../../domain/portal-responsibility'

export type ResponsibilitySelection = Readonly<{
  portalId: string
  kind: ResponsibilityKind
}>

export type StaffParticipationRepository = Readonly<{
  findById: (
    organizationId: string,
    staffParticipationId: string,
  ) => Promise<StaffParticipation | null>
  findActiveByUser: (
    organizationId: string,
    propertyId: string,
    userId: string,
  ) => Promise<StaffParticipation | null>
  list: (
    organizationId: string,
    filters: Readonly<{ propertyId?: string; userId?: string; activeOnly?: boolean }>,
  ) => Promise<readonly StaffParticipation[]>
  create: (participation: StaffParticipation) => Promise<StaffParticipation>
  archive: (
    organizationId: string,
    staffParticipationId: string,
    at: Date,
    reason: string,
  ) => Promise<StaffParticipation | null>
  listActiveResponsibilities: (
    organizationId: string,
    staffParticipationId: string,
  ) => Promise<readonly PortalResponsibility[]>
  replaceResponsibilities: (
    input: Readonly<{
      organizationId: string
      propertyId: string
      staffParticipationId: string
      selections: readonly ResponsibilitySelection[]
      actorId: string
      at: Date
    }>,
  ) => Promise<readonly PortalResponsibility[]>
}>
