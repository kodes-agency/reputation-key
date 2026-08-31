import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type TestOrganizationQueryExecutor = Readonly<{
  query: (text: string, values?: unknown[]) => Promise<unknown>
}>

export type TestOrganizationCleanupExecutor =
  TestOrganizationQueryExecutor | Pick<Database, 'execute'>

const ORGANIZATION_LIFECYCLE_TEST_TABLES = [
  'organization_exports',
  'organization_lifecycle_command_receipts',
  'organization_lifecycle_authority',
] as const

export async function deleteTestOrganizationsWithExecutor(
  executor: TestOrganizationCleanupExecutor,
  organizationIds: readonly string[],
): Promise<void> {
  const uniqueOrganizationIds = [...new Set(organizationIds)]
  if (uniqueOrganizationIds.length === 0) return

  for (const table of ORGANIZATION_LIFECYCLE_TEST_TABLES) {
    if ('execute' in executor) {
      await executor.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id IN (${sql.join(
          uniqueOrganizationIds.map((organizationId) => sql`${organizationId}`),
          sql`, `,
        )})`,
      )
    } else {
      await executor.query(
        `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
        [uniqueOrganizationIds],
      )
    }
  }
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
