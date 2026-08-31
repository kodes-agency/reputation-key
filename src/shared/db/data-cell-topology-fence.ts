import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'

export const SINGLE_US_BETA_CUTOVER_KEY = 'single-us-beta-v3'

export class DataCellTopologyCutoverFencedError extends Error {
  readonly code = 'data_cell_topology_cutover_fenced'

  constructor() {
    super('Data Cell topology cutover admission is fenced')
    this.name = 'DataCellTopologyCutoverFencedError'
  }
}

/**
 * Orders an admission transaction against the durable topology fence.
 * The share lock is intentionally held until the caller's transaction ends.
 */
export async function assertSingleUsBetaDataCellAdmissionOpen(
  tx: Pick<Tx, 'execute'>,
): Promise<void> {
  const result = await tx.execute(sql`
    SELECT state
    FROM data_cell_topology_cutovers
    WHERE singleton = TRUE
      AND cutover_key = ${SINGLE_US_BETA_CUTOVER_KEY}
    FOR SHARE
  `)
  const state = result.rows[0]?.state
  if (state === 'fenced') throw new DataCellTopologyCutoverFencedError()
  if (state !== 'open' && state !== 'completed') {
    throw new Error('Data Cell topology cutover authority is unavailable')
  }
}
