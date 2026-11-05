// Reads the per-organization permission version. Lives in shared/db/ because
// drizzle-orm is restricted to shared/db/ + infrastructure/ by the eslint boundary rules.

import { eq } from 'drizzle-orm'
import type { Database } from './index'
import { permissionVersion } from './schema/dac.schema'

/** Drizzle database or transaction snapshot capable of reading the permission version. */
export type RoleDefinitionDatabase = Pick<Database, 'select'>

/**
 * Read the current per-org permission version (the resolver cache invalidation
 * signal — bumped by Postgres triggers on member/role/policy/assignment changes).
 * Returns 0 if no row exists yet (no mutations have occurred for this org).
 */
export async function fetchPermissionVersion(
  db: RoleDefinitionDatabase,
  orgId: string,
): Promise<number> {
  const rows = await db
    .select({ version: permissionVersion.version })
    .from(permissionVersion)
    .where(eq(permissionVersion.organizationId, orgId))
    .limit(1)
  return rows[0]?.version ?? 0
}
