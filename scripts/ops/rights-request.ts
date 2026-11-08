// Operator CLI: manual rights requests (access, guest-response, participant,
// Property and Organization erasure).
//
// Report is the default. Replay lists which journaled erasures a restore to a
// given point undid. Apply is refused in production; outside production it
// validates identity and typed confirmation, then runs the composed executors
// (Reporting's goal, metric and dashboard records, for an Organization) and
// refuses the scopes that have none yet. `out=<dir>` writes the access export. The contract and its tests live in
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
import {
  describeRightsReport,
  planRightsReplay,
  planRightsRequest,
  rightsRequestCommandSpec,
} from '../../src/shared/ops/rights/rights-request-command'
import {
  purgeRightsOrganization,
  writeRightsExport,
} from '../../src/shared/ops/rights/run-rights-executors'
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
      const executors = [createReportingRightsExecutor(getDb())]
      const write = async (path: string, bytes: Uint8Array) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes, { mode: 0o600 })
      }
      if (plan.scope === 'access' || plan.scope === 'organization') {
        for (const line of await writeRightsExport(executors, plan, write)) io.out(line)
      }
      if (plan.mode === 'apply') {
        if (plan.scope !== 'organization') {
          io.err(
            `${rightsRequestCommandSpec.name}: no executor is composed for ${plan.scope} yet; nothing was changed`,
          )
          return 1
        }
        for (const line of await purgeRightsOrganization(executors, plan, new Date())) {
          io.out(line)
        }
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
