import { eq } from 'drizzle-orm'
import type { Database } from './index'
import { userOrganizationBindings } from './schema/identity-governance.schema'
import {
  decideUserOrganizationBinding,
  type UserOrganizationBinding,
  type UserOrganizationBindingDecision,
} from '#/shared/auth/user-organization-binding'

export async function readUserOrganizationBinding(
  database: Database,
  userId: string,
): Promise<UserOrganizationBinding | null> {
  const rows = await database
    .select({
      userId: userOrganizationBindings.userId,
      organizationId: userOrganizationBindings.organizationId,
      state: userOrganizationBindings.state,
      version: userOrganizationBindings.version,
    })
    .from(userOrganizationBindings)
    .where(eq(userOrganizationBindings.userId, userId))
    .limit(1)
  const row = rows[0]
  return row
    ? {
        ...row,
        state: row.state as UserOrganizationBinding['state'],
      }
    : null
}

export async function authorizeUserOrganizationBinding(
  database: Database,
  userId: string,
  activeOrganizationId: string,
): Promise<UserOrganizationBindingDecision> {
  return decideUserOrganizationBinding(
    await readUserOrganizationBinding(database, userId),
    activeOrganizationId,
  )
}
