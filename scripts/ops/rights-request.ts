// Operator CLI: manual rights requests (access, guest-response, participant,
// Property and Organization erasure).
//
// Report is the default. Replay lists which journaled erasures a restore to a
// given point undid. Apply is refused in production; outside production it
// validates identity and typed confirmation, then runs the executors composed
// for the scope (Notification so far) and refuses a scope with none. The
// contract, handler and tests live in src/shared/ops/rights — scripts/ sits
// outside the unit test project, so this file is wiring only.
//
//   pnpm ops rights-request organization --operator <id> --org <id> received=<iso>
//   pnpm ops rights-request property replay --operator <id> --org <id> --property <id> \
//     journal=<file> restore-point=<iso>

import { readFile, writeFile } from 'node:fs/promises'
import { runNotificationRightsRequest } from '../../src/contexts/feed/application/public-api'
import { getEnv } from '../../src/shared/config/env'
import { rightsRequestCommandSpec } from '../../src/shared/ops/rights/rights-request-command'
import { handleRightsRequest } from '../../src/shared/ops/rights/run-rights-request'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    rightsRequestCommandSpec,
    async (ctx, args, io) => {
      const queue = ctx.container.jobQueue
      return handleRightsRequest(
        {
          production: getEnv().NODE_ENV === 'production',
          readFile: (path) => readFile(path, 'utf8'),
          writeExport: (path, text) => writeFile(path, text, { mode: 0o600 }),
          notification: (run) =>
            runNotificationRightsRequest(
              ctx.container.db,
              async (job) => {
                if (!queue) throw new Error('The job queue is not configured')
                await queue.add(job.name, job.data, { jobId: job.jobId })
              },
              run,
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
