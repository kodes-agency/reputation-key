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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createReportingRightsExecutor } from '../../src/contexts/reporting/infrastructure/adapters/reporting-rights.adapter'
import { getEnv } from '../../src/shared/config/env'
import { getDb } from '../../src/shared/db'
import { decodeErasureJournalExport } from '../../src/shared/db/lifecycle/erasure-journal.server'
import { createGoogleRightsExecutor } from '../../src/shared/ops/rights/google-rights-executor'
import { runRightsExecutors } from '../../src/shared/ops/rights/rights-executor'
import {
  describeRightsReport,
  planRightsReplay,
  planRightsRequest,
  rightsRequestCommandSpec,
} from '../../src/shared/ops/rights/rights-request-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    rightsRequestCommandSpec,
    async (ctx, args, io) => {
      const production = getEnv().NODE_ENV === 'production'
      const planned = planRightsRequest(ctx, args, { production })
      if (!planned.ok) {
        io.err(`${rightsRequestCommandSpec.name}: ${planned.error}`)
        return 1
      }
      const { plan } = planned
      for (const line of describeRightsReport(plan)) io.out(line)

      if (plan.mode === 'replay' && plan.journalFile) {
        const journal = decodeErasureJournalExport(
          await readFile(plan.journalFile, 'utf8'),
        )
        for (const item of planRightsReplay(plan, journal.entries)) {
          io.out(`${item.journalId} ${item.scope} ${item.disposition}`)
        }
        return 0
      }
      return runRightsExecutors({
        plan,
        io,
        executors: [
          createGoogleRightsExecutor({ db: getDb() }),
          createReportingRightsExecutor(getDb(), () => new Date()),
        ],
        writeExportFile: async (path, bytes) => {
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, bytes, { mode: 0o600 })
        },
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops rights request failed', err)
  process.exit(1)
})
