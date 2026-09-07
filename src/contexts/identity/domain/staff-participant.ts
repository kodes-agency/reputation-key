export type StaffParticipantStatus = 'active' | 'archived'

/**
 * Organization-owned person/profile used for operational attribution.
 * It intentionally has no login or authorization fields.
 */
export type StaffParticipant = Readonly<{
  id: string
  organizationId: string
  displayName: string
  status: StaffParticipantStatus
  archivedAt: Date | null
  archiveReason: string | null
  revision: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}>

export function createStaffParticipant(
  input: Readonly<{
    id: string
    organizationId: string
    displayName: string
    createdBy: string
    now: Date
  }>,
): StaffParticipant {
  return {
    id: input.id,
    organizationId: input.organizationId,
    displayName: input.displayName,
    status: 'active',
    archivedAt: null,
    archiveReason: null,
    revision: 1,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  }
}
