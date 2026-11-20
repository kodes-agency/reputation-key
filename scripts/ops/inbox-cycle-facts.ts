// Operator CLI: copy the Handling Cycle facts from the heads onto the Inbox rows.
//
// Usage:
//   pnpm ops inbox-cycle-facts backfill --operator <id> [--batch-size <n>]
//     — count the Inbox rows whose facts differ from their head's (writes nothing)
//   pnpm ops inbox-cycle-facts backfill --operator <id> [--batch-size <n>] \
//     --reason <text> --apply
//
// Migration 0158 adds the current cycle number, source revision and state
// revision to inbox_items; this fills them from inbox_handling_cycle_heads in
// bounded batches, item order. Dry run is the default and a second apply finds
// nothing. The work is in the Inbox context and the invocation in
// src/shared/ops/inbox-cycle-facts-command.ts — scripts/ is wiring only.
// Requires DATABASE_URL (+ QUEUE_REDIS_URL for the harness).

import {
  inboxCycleFactsCommandSpec,
  planInboxCycleFacts,
  runInboxCycleFactsBackfill,
} from '../../src/shared/ops/inbox-cycle-facts-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    inboxCycleFactsCommandSpec,
    async (ctx, args, io) => {
      const plan = planInboxCycleFacts(args)
      if (!plan.ok) {
        io.err(`${inboxCycleFactsCommandSpec.name}: ${plan.error}`)
        io.err(`usage: ${inboxCycleFactsCommandSpec.usage}`)
        return 1
      }
      return runInboxCycleFactsBackfill({
        ctx,
        store: ctx.container.inboxMaintenanceRuntime.cycleHeadFacts,
        io,
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:inbox-cycle-facts failed', err)
  process.exit(1)
})
