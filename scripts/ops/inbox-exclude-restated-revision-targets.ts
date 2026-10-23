// Operator CLI: leave the Response Targets of restated Material Review Revisions
// out of every count.
//
// Usage:
//   pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id>
//     — list the cycles it would exclude (counts and ids; writes nothing)
//   pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id> \
//     --reason <text> [--ticket <ref>] --apply
//
// On 2026-10-23 Google restated 62 closed-beta reviews without moving their
// updateTime, and Review minted a revision for each. Inbox opened a Handling
// Cycle with a Response Target that was overdue from birth. The cycles and
// targets are immutable history, so this records, beside each target, that it
// does not count: Review lists the restated revisions of the Property, Inbox
// finds the cycles they opened and writes the rows (inbox_response_target_
// exclusions), and the reminder slots still pending for those cycles are
// cancelled. Dry run is the default; a second apply finds nothing.
// The rules live in the two contexts and the invocation in
// src/shared/ops/inbox-exclude-restated-revision-targets-command.ts —
// scripts/ is wiring only. Requires DATABASE_URL (+ QUEUE_REDIS_URL for the
// harness).

import { createRestatedRevisionExclusionPorts } from '../../src/composition/restated-revision-exclusion-ports'
import {
  inboxExcludeRestatedRevisionTargetsCommandSpec,
  planInboxExcludeRestatedRevisionTargets,
  runInboxExcludeRestatedRevisionTargets,
} from '../../src/shared/ops/inbox-exclude-restated-revision-targets-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    inboxExcludeRestatedRevisionTargetsCommandSpec,
    async (ctx, args, io) => {
      const plan = planInboxExcludeRestatedRevisionTargets(args)
      if (!plan.ok) {
        io.err(`${inboxExcludeRestatedRevisionTargetsCommandSpec.name}: ${plan.error}`)
        io.err(`usage: ${inboxExcludeRestatedRevisionTargetsCommandSpec.usage}`)
        return 1
      }
      const ports = createRestatedRevisionExclusionPorts({
        inbox: ctx.container.inboxMaintenanceRuntime.responseTargetExclusions,
        review: ctx.container.reviewMaintenanceRuntime.restatedRevisions,
        now: () => new Date(),
      })
      return runInboxExcludeRestatedRevisionTargets({
        ctx,
        propertyId: plan.propertyId,
        ports,
        io,
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:inbox failed', err)
  process.exit(1)
})
