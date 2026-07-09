// Staff context — identity membership adapter.
// Implements IdentityMembershipPort by querying the better-auth `member` table
// directly. identityPort.listMembers(ctx) is session-scoped via request headers
// and CANNOT serve an arbitrary (orgId, userId) pair, so a direct existence
// check against the membership table is the only correct implementation for
// validating a target user before createStaffAssignment (ADR 0006: "Staff
// profile creation still depends on Identity for user existence validation").
// Cross-context SQL is encapsulated here in the infrastructure layer where
// it's acceptable (per the inbox-adapter convention).

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import type { IdentityMembershipPort } from '../../application/ports/identity-membership.port'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createIdentityMembershipAdapter = (
  db: Database,
): IdentityMembershipPort => ({
  isMember: (orgId, userId) =>
    trace('staff.identityMembership.isMember', async () => {
      const rows = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.userId, unbrand(userId)),
            eq(member.organizationId, unbrand(orgId)),
          ),
        )
        .limit(1)
      return rows.length > 0
    }),
})
