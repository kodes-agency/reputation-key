import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { dropInboxUseCaseOrganization } from './inbox-database-fixtures-use-cases'

const RUN_PREFIX = randomUUID().slice(0, 8)

/** Keeps a readable id literal but swaps its first block for one random per test file run. */
export const runScopedId = (literal: string): string => RUN_PREFIX + literal.slice(8)

/** Removes everything a use-case test seeded, including its properties and organization. */
export async function dropInboxUseCaseTenant(
  pool: Pool,
  organizationId: string,
  propertyIds: ReadonlyArray<string>,
): Promise<void> {
  await dropInboxUseCaseOrganization(pool, organizationId)
  await pool.query('DELETE FROM properties WHERE organization_id = $1 AND id = ANY($2)', [
    organizationId,
    propertyIds,
  ])
  await pool.query('DELETE FROM organization WHERE id = $1', [organizationId])
}
