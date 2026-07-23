// POST-BETA-1 PB1.2: Team membership with effective-dated intervals.
//
// TeamMembership is an effective-dated relation between a staff
// participation and a team. It carries a role (member|lead).
// It does NOT grant authorization — only PropertyAccessGrant does.
//
// Per ADR 0039:
// - Intervals are half-open: [effective_from, effective_to).
//   effective_to = null means active.
// - The same relation cannot have overlapping active intervals.
// - At most one active lead per team (default).
// - A staff participation must be active for a new membership.
// - Archiving a team closes active memberships; it never cascades history.

export type MembershipRole = 'member' | 'lead'

export interface TeamMembership {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly teamId: string
  readonly staffParticipationId: string
  readonly role: MembershipRole
  readonly effectiveFrom: Date
  readonly effectiveTo: Date | null
  readonly createdBy: string
  readonly endReason: string | null
}

export type MembershipError =
  | { code: 'participation_not_active' }
  | { code: 'overlap_detected'; message: string }
  | { code: 'already_ended' }
  | { code: 'lead_exists'; teamId: string }
  | { code: 'not_active'; effectiveTo: Date | null }
  | { code: 'cannot_change_role_on_ended' }
  | { code: 'start_after_end' }

export function isActive(membership: TeamMembership, asOf: Date): boolean {
  if (membership.effectiveTo !== null && asOf >= membership.effectiveTo) return false
  return asOf >= membership.effectiveFrom
}

export function isLead(membership: TeamMembership): boolean {
  return membership.role === 'lead'
}

export function createMembership(params: {
  id: string
  organizationId: string
  propertyId: string
  teamId: string
  staffParticipationId: string
  role: MembershipRole
  effectiveFrom: Date
  createdBy: string
}): TeamMembership {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    teamId: params.teamId,
    staffParticipationId: params.staffParticipationId,
    role: params.role,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: null,
    createdBy: params.createdBy,
    endReason: null,
  }
}

/**
 * End a membership at the given effective time.
 * The membership interval becomes [effective_from, ended_at).
 */
export function endMembership(
  membership: TeamMembership,
  endedAt: Date,
  reason: string,
): TeamMembership | MembershipError {
  if (membership.effectiveTo !== null) {
    return { code: 'already_ended' }
  }
  if (endedAt <= membership.effectiveFrom) {
    return { code: 'start_after_end' }
  }
  return {
    ...membership,
    effectiveTo: endedAt,
    endReason: reason,
  }
}

/**
 * Change a member's role. This ends the current membership and starts
 * a new one with the new role. The interval is preserved by setting
 * effective_to on the old and effective_from on the new.
 *
 * Per ADR 0039: role changes create a new effective-dated interval.
 */
export function changeRole(
  membership: TeamMembership,
  newRole: MembershipRole,
  effectiveFrom: Date,
  newId: string,
): { ended: TeamMembership; started: TeamMembership } | MembershipError {
  if (membership.effectiveTo !== null) {
    return { code: 'cannot_change_role_on_ended' }
  }
  const ended = endMembership(membership, effectiveFrom, 'role_changed')
  if ('code' in ended) return ended

  const started = createMembership({
    id: newId,
    organizationId: membership.organizationId,
    propertyId: membership.propertyId,
    teamId: membership.teamId,
    staffParticipationId: membership.staffParticipationId,
    role: newRole,
    effectiveFrom,
    createdBy: membership.createdBy,
  })
  return { ended, started }
}

/**
 * Check if two intervals overlap.
 * Intervals are half-open: [from, to). null to means open-ended.
 */
export function intervalsOverlap(
  a: { from: Date; to: Date | null },
  b: { from: Date; to: Date | null },
): boolean {
  const aEnd = a.to ?? new Date(8.64e15)
  const bEnd = b.to ?? new Date(8.64e15)
  return a.from < bEnd && b.from < aEnd
}

/**
 * Validate that a new membership doesn't overlap with existing ones
 * for the same staff participation and team.
 */
export function validateNoOverlap(
  existing: readonly TeamMembership[],
  newFrom: Date,
): MembershipError | null {
  for (const m of existing) {
    if (
      intervalsOverlap(
        { from: m.effectiveFrom, to: m.effectiveTo },
        { from: newFrom, to: null },
      )
    ) {
      return {
        code: 'overlap_detected',
        message: `Overlaps with membership ${m.id} [${m.effectiveFrom.toISOString()}, ${m.effectiveTo?.toISOString() ?? 'null'})`,
      }
    }
  }
  return null
}

/**
 * Validate that a new lead membership doesn't conflict with an existing
 * active lead. Default: at most one active lead per team.
 */
export function validateLeadUniqueness(
  existingMemberships: readonly TeamMembership[],
  teamId: string,
  asOf: Date,
): MembershipError | null {
  const hasActiveLead = existingMemberships.some(
    (m) => m.teamId === teamId && m.role === 'lead' && isActive(m, asOf),
  )
  if (hasActiveLead) {
    return { code: 'lead_exists', teamId }
  }
  return null
}
