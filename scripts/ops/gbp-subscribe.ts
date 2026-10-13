// Operator CLI (BQC-7.5): report which of an organization's Google
// connections a GBP Pub/Sub subscribe would cover. REPORT ONLY: `--apply` is
// refused by the operator harness.
//
// Subscribing calls Google, and operator commands run without the Google
// provider runtime, so this command cannot do it
// (src/shared/ops/google-provider-commands.ts). The worker does, by itself:
//
//   1. ON IMPORT. The import path calls `subscribe` for every property that
//      goes live.
//
//   2. DAILY. The `reconcile-gbp-notification-subscriptions` job runs the same
//      backfill for every organization: it subscribes accounts imported while
//      push was off or broken, and re-points every account after a
//      GBP_PUBSUB_TOPIC change (Google stores the topic on the GBP account,
//      not in our config). It first runs right after the worker boots on the
//      deploy that installs it, then every 24 hours.
//
// The report lists the candidate connections and their statuses and calls
// Google zero times.
//
// Usage:
//   pnpm ops gbp-subscribe --operator <id> --org <id>
//
// Requires DATABASE_URL + QUEUE_REDIS_URL (composition wires the job queue).

import { createGbpSubscribeOperatorAction } from '../../src/contexts/integration/application/use-cases/gbp-subscribe-backfill'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:gbp-subscribe'
const USAGE = 'pnpm ops gbp-subscribe --operator <id> --org <id>'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'org',
      mutation: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const { container } = ctx
      return createGbpSubscribeOperatorAction(
        container.integrationMaintenanceRuntime.subscribeNotifications,
      )(ctx, args, io)
    },
  )
  process.exit(result.exitCode)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
  process.exit(1)
})
