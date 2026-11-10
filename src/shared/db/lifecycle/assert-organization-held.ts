import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

/** A purge may only run on an Organization whose lifecycle is no longer active. */
export async function assertOrganizationHeld(
  tx: Tx,
  organization: string,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT state FROM organization_lifecycle_authority
    WHERE organization_id = ${organization}
  `)
  const state = (result.rows[0] as { state?: string } | undefined)?.state
  if (state === undefined) throw new Error('Organization has no lifecycle record')
  if (state === 'active') {
    throw new Error('Organization is still active; suspend it before a purge')
  }
}
