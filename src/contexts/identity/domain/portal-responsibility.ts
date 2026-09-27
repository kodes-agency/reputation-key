// Portal responsibility — effective-dated Staff attribution to a Portal.
//
// A PortalResponsibility attributes a Staff Participation to a Portal over a
// half-open [effective_from, effective_to) interval. It does NOT grant access
// (ADR 0052). A Portal has one active primary plus any supporting
// responsibilities; reassignment changes future attribution only.
//
// These rules are enforced where responsibilities are written:
// replaceResponsibilities in
// infrastructure/repositories/staff-participation.repository.ts ends and
// starts intervals and refuses a primary Portal another participation holds,
// backed by pr_unique_active_primary, pr_no_overlapping_primary_intervals and
// pr_no_overlapping_responsibility_intervals.

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
