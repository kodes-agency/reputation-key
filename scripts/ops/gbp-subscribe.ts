// Operator CLI (BQC-7.5): subscribe an organization's Google connections to the
// shared GBP Pub/Sub topic — the backfill counterpart of the import path's
// automatic subscribe.
//
// Two jobs, one operation:
//
//   1. BACKFILL. The import path calls `subscribe` for every property that goes
//      live from now on. Tenants that connected before that wiring existed have
//      never been subscribed, so Google publishes nothing for them and their new
//      reviews arrive only on the discovery sweep's cadence. Run this once per
//      organization after setting GBP_PUBSUB_TOPIC.
//
//   2. TOPIC CHANGE. Google stores the Pub/Sub topic on the GBP account, not in
//      our config: changing GBP_PUBSUB_TOPIC leaves every existing subscription
//      pointing at the OLD topic, and push silently keeps flowing somewhere we
//      no longer read. There is deliberately no background reconciler for this —
//      re-running this command with the new topic exported IS the migration, and
//      the old topic stops receiving as soon as each account is re-PATCHed.
//
// DRY-RUN by default: without --apply it lists the candidate connections and
// their statuses and calls Google zero times. --apply requires --reason.
//
// Safely re-runnable. `updateNotificationSetting` is a PATCH of the account's
// single `notificationSetting` resource, and the use case never throws — so a
// partially-failed run is repaired by running it again, and a fully-successful
// run repeated is a no-change re-assertion.
//
// Usage:
//   pnpm ops:gbp-subscribe --operator <id> --org <id>                      — dry-run report
//   pnpm ops:gbp-subscribe --operator <id> --org <id> --reason <text> --apply
//
// Requires DATABASE_URL + REDIS_URL (the composition root wires the job queue)
// and the Google provider env — subscribing decrypts/refreshes the connection's
// access token and calls Google, so this must run where those are reachable.
// Exits 1 when an applied run left any candidate short of `subscribed`; the JSON
// report names the per-connection outcome. `topic_unset` there means
// GBP_PUBSUB_TOPIC is empty in THIS process's environment.

import { getContainer } from '../../src/composition'
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
      const container = getContainer()
      return createGbpSubscribeOperatorAction(
        container.useCases.gbpSubscribeBackfill,
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
