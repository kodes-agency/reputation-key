// POST-BETA-1 PB1.3: Portal responsibility with effective-dated intervals.
//
// PortalResponsibility is an effective-dated attribution of a staff
// participation to a portal. It does NOT grant access — only
// PropertyAccessGrant does.
//
// Per ADR 0039/0040:
// - Intervals are half-open: [effective_from, effective_to).
// - At most one active primary per portal (default).
// - A staff participation must be active for a new responsibility.
// - Moving a portal responsibility changes future attribution only;
//   past facts retain the responsible person at event time.
// - Reassigning does not grant or revoke authorization.

export type ResponsibilityKind = 'primary' | 'supporting'

export interface PortalResponsibility {
  readonly id: string
  readonly organizationId: string
  readonly propertyId: string
  readonly portalId: string
  readonly staffParticipationId: string
  readonly kind: ResponsibilityKind
  readonly effectiveFrom: Date
  readonly effectiveTo: Date | null
  readonly createdBy: string
  readonly endReason: string | null
}

export type ResponsibilityError =
  | { code: 'participation_not_active' }
  | { code: 'overlap_detected'; message: string }
  | { code: 'already_ended' }
  | { code: 'primary_exists'; portalId: string }
  | { code: 'not_active'; effectiveTo: Date | null }
  | { code: 'cannot_change_kind_on_ended' }
  | { code: 'start_after_end' }

export function isActive(
  responsibility: PortalResponsibility,
  asOf: Date = new Date(),
): boolean {
  if (responsibility.effectiveTo !== null && asOf >= responsibility.effectiveTo)
    return false
  return asOf >= responsibility.effectiveFrom
}

export function isPrimary(responsibility: PortalResponsibility): boolean {
  return responsibility.kind === 'primary'
}

export function createResponsibility(params: {
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  staffParticipationId: string
  kind: ResponsibilityKind
  effectiveFrom: Date
  createdBy: string
}): PortalResponsibility {
  return {
    id: params.id,
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    portalId: params.portalId,
    staffParticipationId: params.staffParticipationId,
    kind: params.kind,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: null,
    createdBy: params.createdBy,
    endReason: null,
  }
}

/**
 * End a responsibility at the given effective time.
 */
export function endResponsibility(
  responsibility: PortalResponsibility,
  endedAt: Date,
  reason: string,
): PortalResponsibility | ResponsibilityError {
  if (responsibility.effectiveTo !== null) {
    return { code: 'already_ended' }
  }
  if (endedAt <= responsibility.effectiveFrom) {
    return { code: 'start_after_end' }
  }
  return {
    ...responsibility,
    effectiveTo: endedAt,
    endReason: reason,
  }
}

/**
 * Change a responsibility's kind (primary <-> supporting).
 * Ends the current interval and starts a new one.
 */
export function changeKind(
  responsibility: PortalResponsibility,
  newKind: ResponsibilityKind,
  effectiveFrom: Date,
  newId: string,
): { ended: PortalResponsibility; started: PortalResponsibility } | ResponsibilityError {
  if (responsibility.effectiveTo !== null) {
    return { code: 'cannot_change_kind_on_ended' }
  }
  const ended = endResponsibility(responsibility, effectiveFrom, 'kind_changed')
  if ('code' in ended) return ended

  const started = createResponsibility({
    id: newId,
    organizationId: responsibility.organizationId,
    propertyId: responsibility.propertyId,
    portalId: responsibility.portalId,
    staffParticipationId: responsibility.staffParticipationId,
    kind: newKind,
    effectiveFrom,
    createdBy: responsibility.createdBy,
  })
  return { ended, started }
}

/**
 * Validate that a new primary responsibility doesn't conflict with
 * an existing active primary for the same portal.
 */
export function validatePrimaryUniqueness(
  existing: readonly PortalResponsibility[],
  portalId: string,
  asOf: Date,
): ResponsibilityError | null {
  const hasActivePrimary = existing.some(
    (r) => r.portalId === portalId && r.kind === 'primary' && isActive(r, asOf),
  )
  if (hasActivePrimary) {
    return { code: 'primary_exists', portalId }
  }
  return null
}

/**
 * Resolve the responsible staff for a portal as of a given time.
 * Used for event-time attribution (ADR 0040).
 */
export function resolveResponsibleAt(
  responsibilities: readonly PortalResponsibility[],
  portalId: string,
  asOf: Date,
): readonly PortalResponsibility[] {
  return responsibilities.filter((r) => r.portalId === portalId && isActive(r, asOf))
}
