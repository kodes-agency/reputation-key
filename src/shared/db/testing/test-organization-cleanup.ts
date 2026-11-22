import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type TestOrganizationQueryExecutor = Readonly<{
  query: (text: string, values?: unknown[]) => Promise<unknown>
}>

export type TestOrganizationCleanupExecutor =
  TestOrganizationQueryExecutor | Pick<Database, 'execute'>

export async function deleteTestOrganizationsWithExecutor(
  executor: TestOrganizationCleanupExecutor,
  organizationIds: readonly string[],
): Promise<void> {
  const uniqueOrganizationIds = [...new Set(organizationIds)]
  if (uniqueOrganizationIds.length === 0) return

  if ('execute' in executor) {
    await executor.execute(
      sql`DELETE FROM organization WHERE id IN (${sql.join(
        uniqueOrganizationIds.map((organizationId) => sql`${organizationId}`),
        sql`, `,
      )})`,
    )
  } else {
    await executor.query('DELETE FROM organization WHERE id = ANY($1::text[])', [
      uniqueOrganizationIds,
    ])
  }
}

/** Removes an Organization's Replies ahead of the rows they reference. */
export async function deleteOrganizationReplies(
  db: Pick<Database, 'execute'>,
  organizationId: string,
): Promise<void> {
  await db.execute(sql`DELETE FROM replies WHERE organization_id = ${organizationId}`)
}
