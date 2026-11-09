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
import { getEnv } from '../../src/shared/config/env'
import { parseOperatorIdentities } from '../../src/shared/auth/execution-policy'
import { getDb } from '../../src/shared/db'
import { createRightsJournal } from '../../src/shared/ops/rights/rights-journal'
import { rightsRequestCommandSpec } from '../../src/shared/ops/rights/rights-request-command'
import { handleRightsRequest } from '../../src/shared/ops/rights/run-rights-request'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    rightsRequestCommandSpec,
    async (ctx, args, io) => {
      const queue = ctx.container.jobQueue
      const journal = createRightsJournal(undefined)
      return handleRightsRequest(
        {
          production: getEnv().NODE_ENV === 'production',
          readFile: (path) => readFile(path, 'utf8'),
          writeExportFile: async (path, bytes) => {
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, bytes, { mode: 0o600 })
          },
          journal,
          executors: (finalWarning) =>
            composeRightsExecutors(
              {
                db: getDb(),
                journal,
                operator: {
                  id: ctx.operatorId,
                  authority: {
                    verify: async (id) => parseOperatorIdentities(getEnv()).has(id),
                  },
                },
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
