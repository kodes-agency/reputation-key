/**
 * Identifier-only event-time Primary Staff attribution. This is provenance,
 * not authorization or a mutable person/profile projection.
 */
export type PrimaryStaffAttributionSnapshot = Readonly<{
  staffParticipantId: string
  staffParticipationId: string
  portalResponsibilityId: string
  effectiveFrom: Date
  effectiveTo: Date | null
}>

export function primaryStaffAttributionEquals(
  left: PrimaryStaffAttributionSnapshot | null | undefined,
  right: PrimaryStaffAttributionSnapshot | null | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null
  return (
    left.staffParticipantId === right.staffParticipantId &&
    left.staffParticipationId === right.staffParticipationId &&
    left.portalResponsibilityId === right.portalResponsibilityId &&
    left.effectiveFrom.getTime() === right.effectiveFrom.getTime() &&
    (left.effectiveTo?.getTime() ?? null) === (right.effectiveTo?.getTime() ?? null)
  )
}

export function primaryStaffAttributionContains(
  attribution: PrimaryStaffAttributionSnapshot,
  observedAt: Date,
): boolean {
  return (
    !Number.isNaN(observedAt.getTime()) &&
    !Number.isNaN(attribution.effectiveFrom.getTime()) &&
    attribution.effectiveFrom <= observedAt &&
    (attribution.effectiveTo === null ||
      (!Number.isNaN(attribution.effectiveTo.getTime()) &&
        attribution.effectiveTo > observedAt))
  )
}
