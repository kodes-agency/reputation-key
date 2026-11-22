// Row text of an Organization's tables, so a test can prove another tenant (or
// the same one after a refusal) is byte-identical.

import type { Pool } from 'pg'
import { expect } from 'vitest'

type SnapshotPool = Pick<Pool, 'query'>

/** `omit` names columns a trigger owns, for comparisons across a restore. */
export async function snapshotTenantTables(
  pool: SnapshotPool,
  tables: readonly string[],
  organizationId: string,
  options: { omit?: string[] } = {},
): Promise<string> {
  const omit = options.omit ?? []
  const parts: string[] = []
  for (const table of tables) {
    const result = await pool.query<{ row: string }>(
      `SELECT (to_jsonb(t.*) - $2::text[])::text AS row FROM ${table} AS t
       WHERE organization_id = $1 ORDER BY (to_jsonb(t.*) - $2::text[])::text`,
      [organizationId, omit],
    )
    parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
  }
  return parts.join('\n')
}

export async function countRows(
  pool: SnapshotPool,
  table: string,
  organizationId: string,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
    [organizationId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** Takes a snapshot of each tenant now; `expectUnchanged` asserts every one is the same later. */
export async function watchTenants(
  snapshotOf: (organizationId: string) => Promise<string>,
  organizationIds: readonly string[],
) {
  const before: string[] = []
  for (const id of organizationIds) before.push(await snapshotOf(id))
  return {
    async expectUnchanged(): Promise<void> {
      const after: string[] = []
      for (const id of organizationIds) after.push(await snapshotOf(id))
      expect(after).toEqual(before)
    },
  }
}
