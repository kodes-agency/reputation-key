export type UserOrganizationMembershipDecision =
  | Readonly<{ kind: 'allow' }>
  | Readonly<{
      kind: 'deny'
      reason:
        | 'organization_membership_missing'
        | 'organization_membership_ambiguous'
        | 'organization_membership_mismatch'
    }>

/**
 * Enforce the closed-beta single-Organization control from Better Auth's
 * membership authority. Duplicate rows for the same Organization do not
 * create ambiguity; two distinct Organizations always fail closed.
 */
export function decideUserOrganizationMembership(
  membershipOrganizationIds: ReadonlyArray<string>,
  activeOrganizationId: string,
): UserOrganizationMembershipDecision {
  let observedOrganizationId: string | undefined
  for (const organizationId of membershipOrganizationIds) {
    if (observedOrganizationId === undefined) {
      observedOrganizationId = organizationId
    } else if (organizationId !== observedOrganizationId) {
      return { kind: 'deny', reason: 'organization_membership_ambiguous' }
    }
  }
  if (observedOrganizationId === undefined) {
    return { kind: 'deny', reason: 'organization_membership_missing' }
  }
  if (observedOrganizationId !== activeOrganizationId) {
    return { kind: 'deny', reason: 'organization_membership_mismatch' }
  }
  return { kind: 'allow' }
}
