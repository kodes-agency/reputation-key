import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/** Source writes may overlap; closing holds their Property fence until commit. */
export async function lockMetricSource(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  mode: 'writer' | 'closure',
): Promise<boolean> {
  const key = `metric-source:${organizationId}:${propertyId}`
  const result = await tx.execute(
    mode === 'writer'
      ? sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
      : sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`,
  )
  return mode === 'writer' || result.rows[0]?.['locked'] === true
}
