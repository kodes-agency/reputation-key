// Test-only: gives a goal month a target of its own after the fact.
//
// guard_goal_monthly_result_v1 lets a month take its own target only while the
// month is open and still running on the database clock, on INSERT as well as
// on UPDATE. A fixture cannot wait for a month to end, so it writes the target
// with the guard switched off. The row is then what a change made while the
// month ran would have left behind.
//
// Production code never does this. Its only guard bypass is the Organization
// purge, which deletes.

import type { ClientBase, Pool } from 'pg'

/**
 * Writes `targetValue` on a month the target lock no longer admits: one that
 * has ended, is reconciling or is closed.
 *
 * `client` must be inside a transaction. `ALTER TABLE ... DISABLE TRIGGER` is
 * transactional, so no other session sees the guard off, and a failure rolls
 * the switch back with everything else.
 */
export async function seedLockedMonthTarget(
  client: Pick<ClientBase, 'query'>,
  monthlyResultId: string,
  targetValue: number,
): Promise<void> {
  await client.query(
    `ALTER TABLE goal_monthly_results DISABLE TRIGGER goal_monthly_results_guard`,
  )
  const updated = await client.query(
    `UPDATE goal_monthly_results SET target_value = $2 WHERE id = $1`,
    [monthlyResultId, targetValue],
  )
  await client.query(
    `ALTER TABLE goal_monthly_results ENABLE TRIGGER goal_monthly_results_guard`,
  )
  if (updated.rowCount !== 1) {
    throw new Error(`No goal month ${monthlyResultId} to give a target to`)
  }
}

/** The same for a fixture that commits its rows: one transaction of its own. */
export async function seedLockedMonthTargetCommitted(
  pool: Pool,
  monthlyResultId: string,
  targetValue: number,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await seedLockedMonthTarget(client, monthlyResultId, targetValue)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
