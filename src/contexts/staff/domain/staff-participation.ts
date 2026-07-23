// POST-BETA-1 PB1.1: Staff participation lifecycle.
//
// StaffParticipation tracks that a user participates as staff at a
// property. It holds display/profile fields and an active lifecycle,
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
  readonly userId: string
  readonly displayName: string
  readonly status: ParticipationStatus
  readonly startedAt: Date
  readonly endedAt: Date | null
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
  userId: string
  displayName: string
  createdBy: string
  now: Date
}): StaffParticipation {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    userId: params.userId,
    displayName: params.displayName,
    status: 'active',
    startedAt: params.now,
    endedAt: null,
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
    updatedAt: now,
  }
}

export function archive(
  participation: StaffParticipation,
  now: Date,
): StaffParticipation | ParticipationError {
  if (!isValidTransition(participation.status, 'archived')) {
    if (participation.status === 'archived') return { code: 'already_archived' }
    return { code: 'invalid_transition', from: participation.status, to: 'archived' }
  }
  return {
    ...participation,
    status: 'archived',
    endedAt: participation.endedAt ?? now,
    updatedAt: now,
  }
}

export function updateProfile(
  participation: StaffParticipation,
  displayName: string,
  now: Date,
): StaffParticipation {
  return {
    ...participation,
    displayName,
    updatedAt: now,
  }
}
