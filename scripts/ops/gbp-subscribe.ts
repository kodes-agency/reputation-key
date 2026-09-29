// Operator CLI (BQC-7.5): subscribe an organization's Google connections to the
// shared GBP Pub/Sub topic — the on-demand counterpart of the import path's
// automatic subscribe and of the worker's daily
// `reconcile-gbp-notification-subscriptions` job, which runs this same backfill
// for every organization.
//
// Two jobs, one operation:
//
//   1. BACKFILL. The import path calls `subscribe` for every property that goes
//      live. Accounts imported while push was off or broken were never
//      subscribed, so Google publishes nothing for them and their new reviews
//      arrive only on the discovery sweep's cadence. The daily job repairs them
//      within a day; run this to repair one organization now.
//
//   2. TOPIC CHANGE. Google stores the Pub/Sub topic on the GBP account, not in
//      our config: changing GBP_PUBSUB_TOPIC leaves every existing subscription
//      pointing at the OLD topic until the account is re-PATCHed. The daily job
//      re-points every account within a day; running this with the new topic
//      exported does it immediately for one organization.
//
// DRY-RUN by default: without --apply it lists the candidate connections and
// their statuses and calls Google zero times. --apply requires --reason.
//
// Safely re-runnable. `subscribe` reads the account's single
// `notificationSetting` resource and PATCHes it only when it differs, and the
// use case never throws — so a partially-failed run is repaired by running it
// again, and a fully-successful run repeated reports `already_subscribed`.
//
// Usage:
//   pnpm ops gbp-subscribe --operator <id> --org <id>                      — dry-run report
//   pnpm ops gbp-subscribe --operator <id> --org <id> --reason <text> --apply
//
// Requires DATABASE_URL + QUEUE_REDIS_URL (composition wires the job queue)
// and the Google provider env — subscribing decrypts/refreshes the connection's
// access token and calls Google, so this must run where those are reachable
// (not from outside a private network — that is why the daily job exists).
// Exits 1 when an applied run left any candidate short of `subscribed` or
// `already_subscribed`; the JSON report names the per-connection outcome and
// account tallies. `topic_unset` there means
// GBP_PUBSUB_TOPIC is empty in THIS process's environment.

import { createGbpSubscribeOperatorAction } from '../../src/contexts/integration/application/use-cases/gbp-subscribe-backfill'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:gbp-subscribe'
const USAGE = `pnpm ${COMMAND_NAME} --operator <id> --org <id> [--reason <text> --apply]`

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
        COMMAND_NAME,
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
