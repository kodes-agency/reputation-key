// Accessible-Property scoping for raw SQL reads.
//
// Scoped reads carry "which Properties may this caller see" as `null` for
// Organization-wide access or as the list of Property ids a grant covers. A
// repository that reads Properties with hand-written SQL turns that answer into
// one WHERE predicate here rather than spelling the three cases again.

import { sql, type SQL } from 'drizzle-orm'

/**
 * Limits `propertyIdColumn` to the caller's accessible Properties: `null` limits
 * nothing, an empty list matches no row, and otherwise the column must equal one
 * of the ids, each bound as a parameter and cast to uuid.
 */
export function propertyIdInScope(
  propertyIdColumn: SQL,
  propertyIds: readonly string[] | null,
): SQL {
  if (propertyIds === null) return sql`true`
  if (propertyIds.length === 0) return sql`false`
  return sql`${propertyIdColumn} IN (${sql.join(
    propertyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`
}
