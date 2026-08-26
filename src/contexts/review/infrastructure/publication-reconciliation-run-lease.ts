import { getPool } from '#/shared/db/pool'
import type {
  PublicationReconciliationRunLease,
  PublicationReconciliationRunLeaseHandle,
} from '../application/ports/publication-reconciliation-run-lease.port'

const RECONCILIATION_RUN_LOCK = 'repkey:review:publication-reconciliation-sweep:v1'

/**
 * Hold a dedicated PostgreSQL session advisory lock for the full sweep. The
 * checked-out client is deliberately not returned to the pool until release;
 * this makes exclusion global across Railway replicas that share the database.
 * A dropped session releases PostgreSQL advisory locks automatically.
 */
export function createPublicationReconciliationRunLease(): PublicationReconciliationRunLease {
  return {
    tryAcquire: async (): Promise<PublicationReconciliationRunLeaseHandle | null> => {
      const client = await getPool().connect()
      try {
        const result = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
          [RECONCILIATION_RUN_LOCK],
        )
        if (result.rows[0]?.acquired !== true) {
          client.release()
          return null
        }

        let released = false
        return {
          release: async () => {
            if (released) return
            released = true
            try {
              await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
                RECONCILIATION_RUN_LOCK,
              ])
            } finally {
              client.release()
            }
          },
        }
      } catch (error) {
        client.release()
        throw error
      }
    },
  }
}
