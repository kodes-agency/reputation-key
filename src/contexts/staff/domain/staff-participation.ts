// POST-BETA-1 PB1.1: Staff participation lifecycle.
//
// StaffParticipation tracks that a StaffParticipant participates at a
// property. A participant may exist without a login; linkedUserId is a
// read-only projection of an optional current StaffUserLink.
// but NOT authorization (that's PropertyAccessGrant) and NOT team
// membership (that's TeamMembership).
//
// Per ADR 0039: removing property access does not erase participation
// or history. Participation can outlive access for attribution purposes.
//
// Lifecycle:  active -> inactive -> active (reactivation)
//                  \-> archived (terminal)

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

export type ParticipationError =
  | { code: 'already_active'; participationId: string }
  | { code: 'not_active'; status: ParticipationStatus }
  | { code: 'already_archived' }
  | { code: 'invalid_transition'; from: ParticipationStatus; to: ParticipationStatus }

const VALID_TRANSITIONS: Readonly<
  Record<ParticipationStatus, readonly ParticipationStatus[]>
> = {
  active: ['inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: [],
}

export function isValidTransition(
  from: ParticipationStatus,
  to: ParticipationStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function isActive(participation: StaffParticipation): boolean {
  return participation.status === 'active'
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

export function deactivate(
  participation: StaffParticipation,
  now: Date,
): StaffParticipation | ParticipationError {
  if (!isValidTransition(participation.status, 'inactive')) {
    if (participation.status === 'archived') return { code: 'already_archived' }
    return { code: 'invalid_transition', from: participation.status, to: 'inactive' }
  }
  return {
    ...participation,
    status: 'inactive',
    endedAt: now,
    revision: participation.revision + 1,
    updatedAt: now,
  }
}

export function reactivate(
  participation: StaffParticipation,
  now: Date,
): StaffParticipation | ParticipationError {
  if (!isValidTransition(participation.status, 'active')) {
    if (participation.status === 'active')
      return { code: 'already_active', participationId: participation.id }
    return { code: 'invalid_transition', from: participation.status, to: 'active' }
  }
  return {
    ...participation,
    status: 'active',
    endedAt: null,
    revision: participation.revision + 1,
    updatedAt: now,
  }
}

export function archive(
  participation: StaffParticipation,
  now: Date,
  reason: string,
): StaffParticipation | ParticipationError {
  if (!isValidTransition(participation.status, 'archived')) {
    if (participation.status === 'archived') return { code: 'already_archived' }
    return { code: 'invalid_transition', from: participation.status, to: 'archived' }
  }
  return {
    ...participation,
    status: 'archived',
    endedAt: participation.endedAt ?? now,
    archiveReason: reason,
    revision: participation.revision + 1,
    updatedAt: now,
  }
}
