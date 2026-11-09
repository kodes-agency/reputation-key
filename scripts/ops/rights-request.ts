// Operator CLI: manual rights requests (access, guest-response, participant,
// Property and Organization erasure).
//
// Report is the default. Replay lists which journaled erasures a restore to a
// given point undid. Apply is refused in production; outside production it
// validates identity and typed confirmation, then runs the executors composed
// for the scope (below). The contract and its tests live in
// src/shared/ops/rights/rights-request-command.ts — scripts/ sits outside the
// unit test project, so this file is wiring only.
//
//   pnpm ops rights-request organization --operator <id> --org <id> received=<iso>
//   pnpm ops rights-request property replay --operator <id> --org <id> --property <id> \
//     journal=<file> restore-point=<iso>

import { composeRightsExecutors } from '../../src/composition/rights-executors'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runNotificationRightsRequest } from '../../src/contexts/feed/application/public-api'
import { createS3StorageAdapter } from '../../src/contexts/portal/infrastructure/adapters/s3-storage.adapter'
import { getEnv } from '../../src/shared/config/env'
import { getDb } from '../../src/shared/db'
import { createRightsJournal } from '../../src/shared/ops/rights/rights-journal'
import { rightsRequestCommandSpec } from '../../src/shared/ops/rights/rights-request-command'
import { handleRightsRequest } from '../../src/shared/ops/rights/run-rights-request'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    rightsRequestCommandSpec,
    async (ctx, args, io) => {
      const env = getEnv()
      const queue = ctx.container.jobQueue
      return handleRightsRequest(
        {
          production: env.NODE_ENV === 'production',
          readFile: (path) => readFile(path, 'utf8'),
          writeExportFile: async (path, bytes) => {
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, bytes, { mode: 0o600 })
          },
          journal: createRightsJournal(undefined),
          executors: (finalWarning) =>
            composeRightsExecutors(
              {
                db: getDb(),
                portalObjectStore: createS3StorageAdapter({
                  accessKey: env.AWS_S3_ACCESS_KEY,
                  secretKey: env.AWS_S3_SECRET_ACCESS_KEY,
                  bucketName: env.AWS_S3_BUCKET_NAME,
                  region: env.AWS_S3_REGION,
                  internalEndpoint: env.S3_INTERNAL_ENDPOINT,
                  presignEndpoint: env.S3_PRESIGN_ENDPOINT,
                  forcePathStyle: env.S3_FORCE_PATH_STYLE,
                }),
                runNotification: (run) =>
                  runNotificationRightsRequest(
                    ctx.container.db,
                    async (job) => {
                      if (!queue) throw new Error('The job queue is not configured')
                      await queue.add(job.name, job.data, { jobId: job.jobId })
                    },
                    run,
                  ),
              },
              finalWarning,
            ),
        },
        ctx,
        args,
        io,
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops rights request failed', err)
  process.exit(1)
})
