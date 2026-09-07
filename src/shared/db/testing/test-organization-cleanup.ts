import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type TestOrganizationQueryExecutor = Readonly<{
  query: (text: string, values?: unknown[]) => Promise<unknown>
}>

export type TestOrganizationCleanupExecutor =
  TestOrganizationQueryExecutor | Pick<Database, 'execute'>

const ORGANIZATION_LIFECYCLE_TEST_TABLES = [
  'organization_exports',
  'organization_lifecycle_authority',
] as const

const ORGANIZATION_LIFECYCLE_EVENTS_TRIGGER = 'organization_lifecycle_events_append_only'

async function setLifecycleEventsGuard(
  executor: TestOrganizationCleanupExecutor,
  enabled: boolean,
): Promise<void> {
  const action = enabled ? 'ENABLE ALWAYS' : 'DISABLE'
  const statement = `ALTER TABLE organization_lifecycle_events ${action} TRIGGER ${ORGANIZATION_LIFECYCLE_EVENTS_TRIGGER}`
  if ('execute' in executor) {
    await executor.execute(sql.raw(statement))
  } else {
    await executor.query(statement)
  }
}

async function deleteLifecycleEvents(
  executor: TestOrganizationCleanupExecutor,
  organizationIds: readonly string[],
): Promise<void> {
  await setLifecycleEventsGuard(executor, false)
  try {
    if ('execute' in executor) {
      await executor.execute(
        sql`DELETE FROM organization_lifecycle_events WHERE organization_id IN (${sql.join(
          organizationIds.map((organizationId) => sql`${organizationId}`),
          sql`, `,
        )})`,
      )
    } else {
      await executor.query(
        'DELETE FROM organization_lifecycle_events WHERE organization_id = ANY($1::text[])',
        [organizationIds],
      )
    }
  } finally {
    await setLifecycleEventsGuard(executor, true)
  }
}

export async function deleteTestOrganizationsWithExecutor(
  executor: TestOrganizationCleanupExecutor,
  organizationIds: readonly string[],
): Promise<void> {
  const uniqueOrganizationIds = [...new Set(organizationIds)]
  if (uniqueOrganizationIds.length === 0) return

  await deleteLifecycleEvents(executor, uniqueOrganizationIds)

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
