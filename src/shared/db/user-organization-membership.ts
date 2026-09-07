import { eq } from 'drizzle-orm'
import type { Database } from './index'
import { member } from './schema/auth'
import {
  decideUserOrganizationMembership,
  type UserOrganizationMembershipDecision,
} from '#/shared/auth/user-organization-membership'

export async function readUserOrganizationMemberships(
  database: Database,
  userId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await database
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
  return rows.map((row) => row.organizationId)
}

export async function authorizeUserOrganizationMembership(
  database: Database,
  userId: string,
  activeOrganizationId: string,
): Promise<UserOrganizationMembershipDecision> {
  return decideUserOrganizationMembership(
    await readUserOrganizationMemberships(database, userId),
    activeOrganizationId,
  )
}
