import type { StaffParticipation } from '../../domain/staff-participation'
import type { StaffParticipant } from '../../domain/staff-participant'
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
  createParticipantWithParticipation: (
    input: Readonly<{
      participant: StaffParticipant
      participation: StaffParticipation
    }>,
  ) => Promise<StaffParticipation>
  archive: (
    organizationId: string,
    staffParticipationId: string,
    at: Date,
    reason: string,
    expectedRevision: number,
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
      expectedRevision: number
    }>,
  ) => Promise<
    Readonly<{ responsibilities: readonly PortalResponsibility[]; revision: number }>
  >
}>
