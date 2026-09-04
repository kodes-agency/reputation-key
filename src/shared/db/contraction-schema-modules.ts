// Schema reflection for the contraction-inventory registry.
//
// The registry itself is policy: which table maps to which inventory command,
// and whether every contraction candidate has exactly one. Resolving a Drizzle
// export to its physical table name is not policy — it is schema reflection,
// and Drizzle imports are confined to shared/db/ and context infrastructure.
// Keeping the reflection here lets the governance authority stay free of the
// ORM instead of widening the import rule for it.

import { getTableName, isTable } from 'drizzle-orm'
import * as badgeSchema from './schema/badge.schema'
import * as goalSchema from './schema/goal.schema'
import * as googleImportCompatibilitySchema from './schema/google-import-compatibility.schema'
import * as guestSchema from './schema/guest.schema'
import * as leaderboardSchema from './schema/leaderboard.schema'
import * as peopleAccessSchema from './schema/people-access.schema'
import * as portalSchema from './schema/portal.schema'
import * as staffAssignmentSchema from './schema/staff-assignment.schema'
import * as teamSchema from './schema/team.schema'

/** Schema-file name to its imported Drizzle module, injected by the caller. */
export type SchemaModuleMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/**
 * Every schema file that currently declares a contraction candidate. A new
 * candidate in an unlisted file makes the resolver throw rather than quietly
 * drop the table from the coverage arithmetic.
 */
export const CONTRACTION_SCHEMA_MODULES: SchemaModuleMap = Object.freeze({
  'badge.schema.ts': badgeSchema,
  'goal.schema.ts': goalSchema,
  'google-import-compatibility.schema.ts': googleImportCompatibilitySchema,
  'guest.schema.ts': guestSchema,
  'leaderboard.schema.ts': leaderboardSchema,
  'people-access.schema.ts': peopleAccessSchema,
  'portal.schema.ts': portalSchema,
  'staff-assignment.schema.ts': staffAssignmentSchema,
  'team.schema.ts': teamSchema,
})

/**
 * The physical table name behind one schema export.
 *
 * @throws when the schema file is not registered above, or when the named
 *   export is not a Drizzle table — either would silently shrink the
 *   contraction coverage set.
 */
export function resolvePhysicalTableName(
  modules: SchemaModuleMap,
  schemaFile: string,
  exportName: string,
): string {
  const module = modules[schemaFile]
  if (!module) throw new Error('contraction_inventory_schema_module_missing')
  const table = module[exportName]
  if (!isTable(table)) throw new Error('contraction_inventory_table_export_missing')
  return getTableName(table)
}
