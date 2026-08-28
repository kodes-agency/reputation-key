// Audited, bounded Recent Activity readiness and recovery command.
//
// Report only:
//   pnpm ops:recover-recent-activity --operator <id> <observed-at>
//
// Recover one bounded page (repeat with the emitted cursor until complete):
//   pnpm ops:recover-recent-activity --operator <id> --batch-size 100
//     --apply --reason <text> <observed-at> [<after-occurred-at> <after-replay-key>]

import { parseRecentActivityRecoveryInvocation } from '../../src/contexts/activity/application/recent-activity-recovery-invocation'
import { createRecentActivityRecoveryRuntime } from '../../src/contexts/activity/infrastructure/recent-activity-recovery-runtime'
import { getDb } from '../../src/shared/db'
import { getLogger } from '../../src/shared/observability/logger'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:recover-recent-activity'
const USAGE =
  'pnpm ops:recover-recent-activity --operator <id> [--batch-size <1..100>] [--apply --reason <text>] <observed-at> [<after-occurred-at> <after-replay-key>]'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      capability: 'activity.use',
      mutation: true,
      batchSize: { default: 100, max: 100 },
      usage: USAGE,
    },
    async (context, args, io) => {
      let invocation: ReturnType<typeof parseRecentActivityRecoveryInvocation>
      try {
        invocation = parseRecentActivityRecoveryInvocation(args.positionals)
      } catch (error) {
        io.err(
          `${error instanceof Error ? error.message : String(error)}\nusage: ${USAGE}`,
        )
        return 2
      }

      const runtime = createRecentActivityRecoveryRuntime(getDb(), getLogger())
      const before = await runtime.getRecentActivityReadiness({
        observedAt: invocation.observedAt,
      })
      if (context.dryRun) {
        io.out(JSON.stringify({ action: 'readiness', readiness: before }, null, 2))
        return before.state === 'unavailable' ? 1 : 0
      }

      const recovery = await runtime.recoverRecentActivity({
        observedAt: invocation.observedAt,
        limit: context.batchSize,
        ...(invocation.after ? { after: invocation.after } : {}),
      })
      const after = await runtime.getRecentActivityReadiness({
        observedAt: invocation.observedAt,
      })
      io.out(
        JSON.stringify(
          {
            action: 'recover',
            readinessBefore: before,
            recovery,
            readinessAfter: after,
          },
          null,
          2,
        ),
      )
      return recovery.failed > 0 || after.state === 'unavailable' ? 1 : 0
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
