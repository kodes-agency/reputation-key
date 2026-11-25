import {
  erasureJournalBucketFromEnv,
  type ErasureJournalBucketEnv,
} from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import type { journalBeforeErasure } from '#/shared/db/lifecycle/erasure-journal.server'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { captureObservabilityException } from '#/shared/observability/telemetry'

export type GuestWithdrawalJournal = Parameters<typeof journalBeforeErasure>[1] &
  Readonly<{ idGen: () => string }>

export type GuestWithdrawalJournalConfig = Readonly<ErasureJournalBucketEnv>

// Class only: never the key, the bytes or the message, which can carry either.
function describeFailure(error: unknown): { errorName: string; s3Code?: string } {
  if (!(error instanceof Error)) return { errorName: 'NonError' }
  const code = (error as { Code?: unknown }).Code
  return typeof code === 'string'
    ? { errorName: error.name, s3Code: code }
    : { errorName: error.name }
}

export function createGuestWithdrawalJournal(
  deps: Readonly<{
    logger: LoggerPort
    idGen: () => string
    config?: GuestWithdrawalJournalConfig
  }>,
): GuestWithdrawalJournal {
  const bucketFor = erasureJournalBucketFromEnv(deps.config ?? {})
  let failureClass: Readonly<{ errorName: string; s3Code?: string }> | undefined
  return {
    idGen: deps.idGen,
    alert: () => {
      if (failureClass) {
        deps.logger.error(failureClass, 'guest.erasure_journal_write_failed')
      } else {
        deps.logger.error('guest.erasure_journal_write_failed')
      }
      const error = new Error('Guest withdrawal journal write failed')
      error.name = 'GuestErasureJournalWriteFailed'
      captureObservabilityException(error, {
        source: 'alert-dispatcher',
        alert: { name: 'guest.erasure_journal_write_failed', severity: 'P2' },
      })
    },
    put: async (key, bytes) => {
      const bucket = bucketFor()
      try {
        await bucket.put(key, bytes)
      } catch (error) {
        failureClass = describeFailure(error)
        throw error
      }
    },
  }
}
