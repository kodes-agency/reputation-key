// Drizzle-backed role-definition fetch for the dynamic resolver (ADR 0001 Stage 2).
// Lives in shared/db/ because drizzle-orm is restricted to shared/db/ + infrastructure/
// by the eslint boundary rules. The pure mapping (mapRoleDefinitions) is imported from
// shared/auth/role-definitions so it stays unit-testable without a DB.

import { eq } from 'drizzle-orm'
import type { Database } from './index'
import { organizationRole } from './schema/auth'
import { organizationRolePolicy } from './schema/dac.schema'
import { mapRoleDefinitions } from '#/shared/auth/role-definitions'
import type { CustomRoleDef, RolePolicy } from '#/shared/auth/resolve-permissions'

/** Fetch + map the custom-role definitions and policies for an organization. */
export async function fetchRoleDefinitions(
  db: Database,
  orgId: string,
): Promise<{ customRoles: readonly CustomRoleDef[]; policies: readonly RolePolicy[] }> {
  const [roleDefRows, policyRows] = await Promise.all([
    db
      .select({ role: organizationRole.role, permission: organizationRole.permission })
      .from(organizationRole)
      .where(eq(organizationRole.organizationId, orgId)),
    db
      .select({
        role: organizationRolePolicy.role,
        dataScope: organizationRolePolicy.dataScope,
      })
      .from(organizationRolePolicy)
      .where(eq(organizationRolePolicy.organizationId, orgId)),
  ])
  return mapRoleDefinitions(roleDefRows, policyRows)
}
