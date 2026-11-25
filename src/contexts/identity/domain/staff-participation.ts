// Staff participation — a Staff Participant's relationship to a Property.
//
// StaffParticipation tracks that a StaffParticipant participates at a
// property. It provides operational and attribution history, not authorization.
// A participant may exist without a login; linkedUserId is a read-only
// projection of an optional current StaffUserLink.
//
// Per ADR 0052: removing property access does not erase participation
// or history.

export type ParticipationStatus = 'active' | 'inactive' | 'archived'

export interface StaffParticipation {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly staffParticipantId: string
  readonly personalPortalId: string | null
  readonly linkedUserId: string | null
  readonly displayName: string
  readonly status: ParticipationStatus
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly archiveReason: string | null
  readonly revision: number
  readonly createdBy: string
  readonly updatedAt: Date
}
