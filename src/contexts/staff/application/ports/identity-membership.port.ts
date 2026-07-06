// Staff context — identity membership port.
// Cross-context port for validating that a target user is a member of an
// organization before a staff assignment is created (ADR 0006: "Staff
// profile creation still depends on Identity for user existence
// validation"). Per architecture: ports are TS types defining capability
// contracts; the composition root supplies the adapter, backed by the
// identity context (or a fake in tests).

import type { OrganizationId, UserId } from '#/shared/domain/ids'

/**
 * Verifies organization membership for a target user. Used by
 * createStaffAssignment to reject dangling assignments for users who are
 * not members of ctx.organizationId — without this, a PropertyManager with
 * property access could create an assignment row for an arbitrary forged
 * userId (a user from another org, or a non-existent id).
 */
export type IdentityMembershipPort = Readonly<{
  /**
   * Returns true iff `userId` is a member of `orgId`.
   * Must NOT throw on "not a member" — return false; throw only on infra errors.
   */
  isMember: (orgId: OrganizationId, userId: UserId) => Promise<boolean>
}>
