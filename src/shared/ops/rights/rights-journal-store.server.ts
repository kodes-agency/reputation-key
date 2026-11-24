import {
  erasureJournalBucketFromEnv,
  type ErasureJournalBucketEnv,
} from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import type { RightsJournalStore } from './rights-journal'

/** The private-bucket journal an operator erasure writes before it deletes. */
export function createRightsJournalStore(
  env: ErasureJournalBucketEnv,
): RightsJournalStore {
  const bucketFor = erasureJournalBucketFromEnv(env)
  return {
    alert: () => {
      const error = new Error('Rights request journal write failed')
      error.name = 'RightsErasureJournalWriteFailed'
      captureObservabilityException(error, {
        source: 'alert-dispatcher',
        alert: { name: 'rights.erasure_journal_write_failed', severity: 'P2' },
      })
    },
    put: (key, bytes) => bucketFor().put(key, bytes),
  }
}
