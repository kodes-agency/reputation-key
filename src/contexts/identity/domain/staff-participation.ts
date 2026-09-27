// Staff participation — a Staff Participant's relationship to a Property.
//
// StaffParticipation tracks that a StaffParticipant participates at a
// property. It provides operational and attribution history, not authorization.
// A participant may exist without a login; linkedUserId is a read-only
// projection of an optional current StaffUserLink.
//
// Per ADR 0052: removing property access does not erase participation
// or history. Archiving is written by
// infrastructure/repositories/staff-participation.repository.ts, which ends the
// participation's open Portal responsibility intervals in the same transaction.

export type ParticipationStatus = 'active' | 'inactive' | 'archived'

export interface StaffParticipation {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly staffParticipantId: string
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

export function createParticipation(params: {
  id: string
  organizationId: string
  propertyId: string
  staffParticipantId: string
  displayName: string
  createdBy: string
  now: Date
}): StaffParticipation {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    staffParticipantId: params.staffParticipantId,
    linkedUserId: null,
    displayName: params.displayName,
    status: 'active',
    startedAt: params.now,
    endedAt: null,
    archiveReason: null,
    revision: 1,
    createdBy: params.createdBy,
    updatedAt: params.now,
  }
}
