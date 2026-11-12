import { S3Client } from '@aws-sdk/client-s3'
import type { Env } from '#/shared/config/env'
import { ErasureJournalBucket } from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import type { journalBeforeErasure } from '#/shared/db/lifecycle/erasure-journal.server'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { captureObservabilityException } from '#/shared/observability/telemetry'

/** Self-service withdrawals journal before deleting; a failed write refuses the withdrawal. */
export const GUEST_WITHDRAWAL_JOURNAL_ACTIVE: boolean = true

export type GuestWithdrawalJournal = Parameters<typeof journalBeforeErasure>[1] &
  Readonly<{ idGen: () => string }>

export type GuestWithdrawalJournalConfig = Readonly<
  Partial<
    Pick<
      Env,
      | 'RESTORE_MODE'
      | 'AWS_S3_REGION'
      | 'AWS_S3_ACCESS_KEY'
      | 'AWS_S3_SECRET_ACCESS_KEY'
      | 'AWS_S3_BUCKET_NAME'
      | 'S3_INTERNAL_ENDPOINT'
      | 'S3_PRESIGN_ENDPOINT'
      | 'S3_FORCE_PATH_STYLE'
    >
  >
>

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
  active = GUEST_WITHDRAWAL_JOURNAL_ACTIVE,
): GuestWithdrawalJournal | undefined {
  if (!active) return undefined
  let bucket: ErasureJournalBucket | undefined
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
      const env = deps.config ?? {}
      if (env.RESTORE_MODE) throw new Error('Bucket access is refused during restore')
      if (!bucket) {
        if (
          !env.AWS_S3_REGION ||
          !env.AWS_S3_ACCESS_KEY ||
          !env.AWS_S3_SECRET_ACCESS_KEY ||
          !env.AWS_S3_BUCKET_NAME
        ) {
          throw new Error('Required bucket credentials are missing')
        }
        bucket = new ErasureJournalBucket(
          new S3Client({
            region: env.AWS_S3_REGION,
            credentials: {
              accessKeyId: env.AWS_S3_ACCESS_KEY,
              secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
            },
            endpoint: env.S3_INTERNAL_ENDPOINT || env.S3_PRESIGN_ENDPOINT || undefined,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          }),
          env.AWS_S3_BUCKET_NAME,
        )
      }
      try {
        await bucket.put(key, bytes)
      } catch (error) {
        failureClass = describeFailure(error)
        throw error
      }
    },
  }
}
