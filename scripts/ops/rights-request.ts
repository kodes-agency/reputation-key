// Operator CLI: manual rights requests (access, guest-response, participant,
// Property and Organization erasure).
//
// Report is the default. Replay lists which journaled erasures a restore to a
// given point undid. Apply is refused in production; outside production it
// validates identity and typed confirmation, then refuses until the executors
// for the scope are composed. The contract and its tests live in
// src/shared/ops/rights/rights-request-command.ts — scripts/ sits outside the
// unit test project, so this file is wiring only.
//
//   pnpm ops rights-request organization --operator <id> --org <id> received=<iso>
//   pnpm ops rights-request property replay --operator <id> --org <id> --property <id> \
//     journal=<file> restore-point=<iso>

import { readFile } from 'node:fs/promises'
import { getEnv } from '../../src/shared/config/env'
import { decodeErasureJournalExport } from '../../src/shared/db/lifecycle/erasure-journal.server'
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
      if (plan.mode === 'apply') {
        io.err(
          `${rightsRequestCommandSpec.name}: no executor is composed for ${plan.scope} yet; nothing was changed`,
        )
        return 1
      }
      return 0
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops rights request failed', err)
  process.exit(1)
})
