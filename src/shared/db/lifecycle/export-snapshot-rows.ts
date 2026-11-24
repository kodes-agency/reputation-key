import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'

export type ExportScalar = string | number | boolean | null
export type ExportRecord = Readonly<Record<string, ExportScalar>>

type SnapshotTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Organization export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Organization export field has an unsupported value: ${field}`)
}

export async function readRows(
  snapshot: SnapshotTransaction,
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return (result.rows as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

/**
 * Refuses a snapshot that began before the request or more than 15 minutes
 * after it, so a replay of the same request reads the same window.
 */
export async function assertSnapshotWindow(
  snapshot: SnapshotTransaction,
  asOf: Date,
): Promise<void> {
  const snapshotRows = await readRows(
    snapshot,
    sql`SELECT transaction_timestamp() AS snapshot_at`,
  )
  const snapshotAt = snapshotRows[0]?.snapshot_at
  if (typeof snapshotAt !== 'string') {
    throw new Error('Organization export snapshot clock is unavailable')
  }
  const snapshotTime = new Date(snapshotAt).getTime()
  const requestTime = asOf.getTime()
  if (
    Number.isNaN(requestTime) ||
    snapshotTime < requestTime ||
    snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
  ) {
    throw new Error('Organization export snapshot window is unavailable')
  }
}

/** UTF-8 byte order, never the database or host locale collation. */
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * Ordering happens here rather than in SQL because `ORDER BY` on a text column
 * follows the database collation, which is a host-configuration input. The last
 * key is always a surrogate id so the order is total.
 */
export function sortRecords(
  rows: readonly ExportRecord[],
  keys: readonly string[],
): ExportRecord[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareText(String(left[key] ?? ''), String(right[key] ?? ''))
      if (result !== 0) return result
    }
    return 0
  })
}

const TS = `AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

/** Renders a timestamptz as a fixed-width UTC ISO string, free of any session
 * `TimeZone` or `DateStyle` setting the connection happens to carry. */
export const utc = (column: string) => sql.raw(`to_char(${column} ${TS})`)
