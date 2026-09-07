// LIF-01-T21 — the classification of a partially applied offboarding.
//
// Removal and leave fence the provider-side authorities BEFORE the Identity
// transaction, so a crash between the two leaves exactly one observable shape:
// every property access grant revoked with the offboarding reason, and a
// membership row that should no longer exist.
//
// The rule lives in the domain so the operator's REPORT and the repair itself
// cannot disagree about what state a user is in — a report that classified
// differently from the command would be worse than no report.

export const PARTIAL_OFFBOARDING_GRANT_REASON = 'member_offboarded'

export const PARTIAL_OFFBOARDING_FINDINGS = [
  /** Membership present, no grant was ever revoked — nothing to repair. */
  'not_offboarding',
  /** Grants revoked by offboarding, membership still present — repairable. */
  'partial_offboarding',
  /** No membership row: the offboarding already completed. */
  'already_offboarded',
] as const

export type PartialOffboardingFinding = (typeof PARTIAL_OFFBOARDING_FINDINGS)[number]

/** Content-free: identifiers and counts only, never a name or an email. */
export type PartialOffboardingObservation = Readonly<{
  organizationId: string
  userId: string
  memberId: string | null
  activeGrantCount: number
  offboardedGrantCount: number
}>

export function classifyPartialOffboarding(
  observation: PartialOffboardingObservation,
): PartialOffboardingFinding {
  if (observation.memberId === null) return 'already_offboarded'
  if (observation.offboardedGrantCount > 0 && observation.activeGrantCount === 0) {
    return 'partial_offboarding'
  }
  return 'not_offboarding'
}
