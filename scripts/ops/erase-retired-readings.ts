// Operator CLI: erase the retired `property.review` readings and their
// corrections, one Organization at a time, behind the erasure journal.
//
//   pnpm ops erase-retired-readings --operator <id> [--org <id>]
//   pnpm ops erase-retired-readings --operator <id> --org <id> verified=<iso> \
//     verification=<ref> 'confirm=ERASE RETIRED READINGS <org>' --reason <text> \
//     --ticket <ref> --apply --yes ops:erase-retired-readings
//
// The contract and its tests live in
// src/shared/ops/retired-readings-erasure-command.ts — scripts/ sits outside
// the unit test project, so this file is wiring only.

import { writeAuditEvent } from '../../src/contexts/feed/application/public-api'
import { createRetiredReadingsStore } from '../../src/contexts/reporting/infrastructure/adapters/retired-readings-erasure.adapter'
import { getEnv } from '../../src/shared/config/env'
import { getDb } from '../../src/shared/db'
import {
  retiredReadingsErasureCommandSpec,
  runRetiredReadingsErasure,
} from '../../src/shared/ops/retired-readings-erasure-command'
import { createRightsJournalStore } from '../../src/shared/ops/rights/rights-journal-store.server'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    retiredReadingsErasureCommandSpec,
    async (ctx, args, io) =>
      runRetiredReadingsErasure(
        {
          store: createRetiredReadingsStore(getDb()),
          journal: createRightsJournalStore(getEnv()),
          audit: async (event) => {
            await writeAuditEvent(ctx.container.db, event)
          },
        },
        ctx,
        args,
        io,
      ),
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops erase retired readings failed', err)
  process.exit(1)
})
