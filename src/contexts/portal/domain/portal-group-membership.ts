// POST-BETA-1 PB1.3: Portal group membership with effective-dated intervals.
//
// PortalGroupMembership is an effective-dated relation between a portal
// and a portal group. It is used for event-time attribution: when a
// source event occurs, the portal's group is resolved as of occurred_at.
//
// Per ADR 0040:
// - Moving a portal to another group ends the old membership interval
//   and starts a new one. Past metric facts retain event-time group attribution.
// - At most one active group membership per portal.
// - A transient group-lookup failure quarantines/retries; it never
//   becomes a silent null fact.

export interface PortalGroupMembership {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  readonly portalGroupId: string
  readonly effectiveFrom: Date
  readonly effectiveTo: Date | null
  readonly createdBy: string
  readonly endReason: string | null
}

export type GroupMembershipError =
  | { code: 'already_ended' }
  | { code: 'group_exists'; portalId: string }
  | { code: 'not_active' }
  | { code: 'start_after_end' }

export type AttributionQuality = 'exact' | 'current_state_backfill' | 'unresolved'

export interface GroupAttributionResult {
  readonly portalGroupId: string | null
  readonly quality: AttributionQuality
  readonly membershipId: string | null
}

export function isActive(membership: PortalGroupMembership, asOf: Date): boolean {
  if (membership.effectiveTo !== null && asOf >= membership.effectiveTo) return false
  return asOf >= membership.effectiveFrom
}

export function createMembership(params: {
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  portalGroupId: string
  effectiveFrom: Date
  createdBy: string
}): PortalGroupMembership {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    portalGroupId: params.portalGroupId,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: null,
    createdBy: params.createdBy,
    endReason: null,
  }
}

/**
 * End a group membership at the given effective time.
 */
export function endMembership(
  membership: PortalGroupMembership,
  endedAt: Date,
  reason: string,
): PortalGroupMembership | GroupMembershipError {
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
 * Move a portal to a different group. Ends the old membership and
 * starts a new one. Past facts retain event-time attribution (ADR 0040).
 */
export function movePortalToGroup(
  current: PortalGroupMembership,
  newGroupId: string,
  effectiveFrom: Date,
  newId: string,
  organizationId: string,
  propertyId: string,
  createdBy: string,
):
  | { ended: PortalGroupMembership; started: PortalGroupMembership }
  | GroupMembershipError {
  const ended = endMembership(current, effectiveFrom, 'moved_to_new_group')
  if ('code' in ended) return ended

  const started = createMembership({
    id: newId,
    organizationId,
    propertyId,
    portalId: current.portalId,
    portalGroupId: newGroupId,
    effectiveFrom,
    createdBy,
  })
  return { ended, started }
}

/**
 * Validate that a portal doesn't already have an active group membership.
 * At most one active group per portal.
 */
export function validateGroupUniqueness(
  existing: readonly PortalGroupMembership[],
  portalId: string,
  asOf: Date,
): GroupMembershipError | null {
  const hasActiveGroup = existing.some(
    (m) => m.portalId === portalId && isActive(m, asOf),
  )
  if (hasActiveGroup) {
    return { code: 'group_exists', portalId }
  }
  return null
}

/**
 * Resolve the portal's group as of a given time (event-time attribution).
 * This is the core function for ADR 0040 compliance.
 *
 * Quality:
 * - 'exact': a membership covers the event time.
 * - 'current_state_backfill': no historical membership covers the event time;
 *   fall back to the earliest membership or current state.
 * - 'unresolved': no membership found at all.
 */
export function resolveGroupAt(
  memberships: readonly PortalGroupMembership[],
  portalId: string,
  asOf: Date,
): GroupAttributionResult {
  const portalMemberships = memberships.filter((m) => m.portalId === portalId)

  // Check for an interval that covers asOf
  const covering = portalMemberships.find((m) => isActive(m, asOf))
  if (covering) {
    return {
      portalGroupId: covering.portalGroupId,
      quality: 'exact',
      membershipId: covering.id,
    }
  }

  // Backfill: no exact cover exists. Use earliest membership as fallback.
  // This represents pre-migration data where exact history is unavailable.
  const earliest = portalMemberships.sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  )[0]

  if (earliest) {
    return {
      portalGroupId: earliest.portalGroupId,
      quality: 'current_state_backfill',
      membershipId: earliest.id,
    }
  }

  // No membership found at all
  return {
    portalGroupId: null,
    quality: 'unresolved',
    membershipId: null,
  }
}
