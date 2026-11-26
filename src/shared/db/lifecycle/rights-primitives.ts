// Helpers the review, inbox and Google rights stores share. Each store keeps
// its own table registries, queries and Property existence check.
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'

export type RightsRow = Readonly<Record<string, unknown>>

/** One Organization, or one Property inside it. */
export type RightsScope = Readonly<{ organizationId: string; propertyId?: string }>

/** An Organization id or a scope, so the Organization entry points keep their shape. */
export type RightsTarget = string | RightsScope

export const scopeOf = (target: RightsTarget): RightsScope =>
  typeof target === 'string' ? { organizationId: target } : target

export const notFound = (scope: RightsScope) =>
  scope.propertyId ? 'property not found' : 'organization not found'

export function toCount(
  label: string,
  row: RightsRow | undefined,
  field: string,
): number {
  const value = Number(row?.[field])
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} rights count is unavailable: ${field}`)
  }
  return value
}

export async function affected(tx: Tx, statement: SQL): Promise<number> {
  return (await tx.execute(statement)).rowCount ?? 0
}

export async function organizationExists(
  tx: Tx,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT 1 AS present FROM organization WHERE id = ${organizationId}`,
  )
  return result.rows.length > 0
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error'
}

class RefusalProbeRolledBack extends Error {}

/**
 * The reason an erasure or purge would be refused, or null. `run` does the
 * readiness checks (and any deletes whose constraints must be found) inside a
 * transaction that always rolls back, so nothing is left changed.
 */
export async function refusalOfProbe(
  db: Database,
  run: (tx: Tx) => Promise<void>,
): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await run(tx)
      throw new RefusalProbeRolledBack()
    })
    return null
  } catch (error) {
    return error instanceof RefusalProbeRolledBack ? null : errorMessage(error)
  }
}
