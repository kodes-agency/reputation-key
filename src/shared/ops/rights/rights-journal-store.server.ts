import { S3Client } from '@aws-sdk/client-s3'
import type { Env } from '#/shared/config/env'
import { ErasureJournalBucket } from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import type { RightsJournalStore } from './rights-journal'

type JournalEnv = Pick<
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

/** The private-bucket journal an operator erasure writes before it deletes. */
export function createRightsJournalStore(env: Partial<JournalEnv>): RightsJournalStore {
  let bucket: ErasureJournalBucket | undefined
  return {
    alert: () => {
      const error = new Error('Rights request journal write failed')
      error.name = 'RightsErasureJournalWriteFailed'
      captureObservabilityException(error, {
        source: 'alert-dispatcher',
        alert: { name: 'rights.erasure_journal_write_failed', severity: 'P2' },
      })
    },
    put: async (key, bytes) => {
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
      await bucket.put(key, bytes)
    },
  }
}
