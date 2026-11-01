import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import type { PersonalPortalLabelWriter } from '../../application/use-cases/rename-personal-portal-labels'

/** The composition seam passes the live Identity transaction, never browser input. */
export const writePersonalPortalLabels: PersonalPortalLabelWriter = async (
  input,
  transaction,
) => {
  if (
    typeof transaction !== 'object' ||
    transaction === null ||
    !('execute' in transaction) ||
    typeof transaction.execute !== 'function'
  )
    throw new Error('The staff name transaction is unavailable')
  if (input.portalIds.length === 0) return
  const tx = transaction as Tx
  await tx.execute(sql`UPDATE portals SET name = ${input.displayName}, updated_at = greatest(${input.at}, updated_at + interval '1 millisecond')
    WHERE organization_id = ${input.organizationId} AND kind = 'personal'
      AND id IN (${sql.join(
        input.portalIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`)
}
