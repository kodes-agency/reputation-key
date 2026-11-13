// Operator CLI: what the retention sweep would do right now, without doing it.
//
//   pnpm ops retention dry-run --operator <id>
//
// Prints one JSON document of subjects, actions, row counts and the oldest
// affected timestamp. The work and its tests live in
// src/shared/db/retention/dry-run-retention.ts — scripts/ is wiring only.

import { RETENTION_RULES } from '../../src/composition/retention-rules'
import { getDb } from '../../src/shared/db'
import {
  formatRetentionDryRun,
  runRetentionDryRun,
} from '../../src/shared/db/retention/dry-run-retention'
import { SCHEDULED_RETENTION_ACTIVE } from '../../src/shared/db/retention/scheduled-retention-activation'
import {
  isRetentionDryRun,
  retentionDryRunCommandSpec,
} from '../../src/shared/ops/retention-dry-run-command'
import { runDatabaseOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runDatabaseOperatorCommand(
    retentionDryRunCommandSpec,
    async (_ctx, args, io) => {
      if (!isRetentionDryRun(args)) {
        io.err(`usage: ${retentionDryRunCommandSpec.usage}`)
        return 1
      }
      const run = await runRetentionDryRun({
        db: getDb(),
        rules: RETENTION_RULES,
        now: new Date(),
      })
      io.out(
        JSON.stringify(
          { scheduledApplyActive: SCHEDULED_RETENTION_ACTIVE, ...run },
          null,
          2,
        ),
      )
      io.out(formatRetentionDryRun(run))
      io.out(
        'read-only: nothing was changed. Covers the registry rules only; Contact Request material, superseded observations, snapshot runs and the Google import lifecycle run their own sweeps.',
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops retention failed', err)
  process.exit(1)
})
