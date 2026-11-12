// Operator CLI: manual rights requests (access, guest-response, participant,
// Property and Organization erasure).
//
// Report is the default. Replay lists which journaled erasures a restore to a
// given point undid. Apply validates identity and typed confirmation, writes
// each context's journal object to the private bucket before that context
// deletes anything (a failed write stops the run; a final warning, which
// deletes nothing, needs no journal), runs the executors composed for the
// scope (below) and records an audit event. The contract and its tests live in
// src/shared/ops/rights/rights-request-command.ts — scripts/ sits outside the
// unit test project, so this file is wiring only.
//
//   pnpm ops rights-request organization --operator <id> --org <id> received=<iso>
//   pnpm ops rights-request property replay --operator <id> --org <id> --property <id> \
//     journal=<file> restore-point=<iso>

import { composeRightsExecutors } from '../../src/composition/rights-executors'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  runNotificationRightsRequest,
  writeAuditEvent,
} from '../../src/contexts/feed/application/public-api'
import { createS3StorageAdapter } from '../../src/contexts/portal/infrastructure/adapters/s3-storage.adapter'
import { getEnv } from '../../src/shared/config/env'
import { parseOperatorIdentities } from '../../src/shared/auth/execution-policy'
import { getDb } from '../../src/shared/db'
import { rightsSubjectRefusal } from '../../src/shared/db/lifecycle/rights-subject-store'
import { createRightsJournal } from '../../src/shared/ops/rights/rights-journal'
import { createRightsJournalStore } from '../../src/shared/ops/rights/rights-journal-store.server'
import { rightsRequestCommandSpec } from '../../src/shared/ops/rights/rights-request-command'
import { handleRightsRequest } from '../../src/shared/ops/rights/run-rights-request'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    rightsRequestCommandSpec,
    async (ctx, args, io) => {
      const env = getEnv()
      const journal = createRightsJournal(createRightsJournalStore(env))
      return handleRightsRequest(
        {
          readFile: (path) => readFile(path, 'utf8'),
          writeExportFile: async (path, bytes) => {
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, bytes, { mode: 0o600 })
          },
          journal,
          auditWrite: async (event) => {
            await writeAuditEvent(ctx.container.db, event)
          },
          subjectRefusal: (plan) => rightsSubjectRefusal(getDb(), plan),
          executors: (finalWarning) =>
            composeRightsExecutors(
              {
                db: getDb(),
                journal,
                portalObjectStore: createS3StorageAdapter({
                  accessKey: env.AWS_S3_ACCESS_KEY,
                  secretKey: env.AWS_S3_SECRET_ACCESS_KEY,
                  bucketName: env.AWS_S3_BUCKET_NAME,
                  region: env.AWS_S3_REGION,
                  internalEndpoint: env.S3_INTERNAL_ENDPOINT,
                  presignEndpoint: env.S3_PRESIGN_ENDPOINT,
                  forcePathStyle: env.S3_FORCE_PATH_STYLE,
                }),
                operator: {
                  id: ctx.operatorId,
                  authority: {
                    verify: async (id) => parseOperatorIdentities(getEnv()).has(id),
                  },
                },
                runNotification: (run) =>
                  runNotificationRightsRequest(
                    ctx.container.db,
                    ctx.container.notificationDelivery.noticeWriter,
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
