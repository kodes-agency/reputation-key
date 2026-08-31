import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  RecoveryCutoverRun,
  RecoveryCutoverRunReader,
} from '#/shared/config/recovery-cutover-attestation'

/** Infrastructure adapter for the recovery cutover boot fence. */
export function createRecoveryCutoverRunReader(db: Database): RecoveryCutoverRunReader {
  return {
    async findLatest(dataCellId): Promise<RecoveryCutoverRun | undefined> {
      const result = await db.execute(sql`
        SELECT id, generation
        FROM recovery_runs
        WHERE data_cell_id = ${dataCellId}
        ORDER BY generation DESC
        LIMIT 1
      `)
      return result.rows[0] as RecoveryCutoverRun | undefined
    },
  }
}
