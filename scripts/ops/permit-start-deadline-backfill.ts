// Operator CLI (BQC-7.5): one-off backfill of execution permits that were
// admitted and then never started, and whose start deadline elapsed before the
// start-deadline sweep existed.
//
// WHY THIS EXISTS: `startExecutionPermit` only observes `start_deadline_elapsed`
// when a caller actually starts a permit, and the only other exit from
// `admitted` is the emergency-kill drain. Before the recurring
// `permit-start-deadline-sweep` job, an abandoned admission stayed `admitted`
// forever, keeping `authorization_execution_permits_active_idx` reporting
// phantom active work. The deployed google-closed-beta database holds 19 such
// rows (13 property.read_gbp_performance + 6 property.import_gbp_v2).
//
// This command is NOT a second implementation. It calls the exact same
// `createExecutionPermitStartDeadlineSweeper` the recurring job uses, which
// routes every candidate through the domain helper
// `fenceElapsedStartDeadlinePermit`. There is no raw UPDATE here and no
// backfill-only predicate, so a fenced-by-backfill row is indistinguishable
// from a fenced-by-sweep row.
//
// The recurring job makes this command unnecessary going forward; it exists so
// the pre-existing orphans clear without waiting for the cadence and without an
// operator hand-writing SQL.
//
// MUTATION (not destructive — no row is deleted; `admitted` rows move to the
// terminal `fenced` state they should already have reached). Deliberately NOT
// capability-gated: fencing stale permits is a lifecycle safety process that
// must work while Google Content capabilities are killed, which is exactly when
// nothing will ever start them.
//
// Usage:
//   pnpm ops:permit-start-deadline-fence --operator <id>
//     — dry-run: reports the candidate count only
//   pnpm ops:permit-start-deadline-fence --operator <id> --reason <text> \
//     --apply --yes ops:permit-start-deadline-fence
//
// Optional: --batch-size <n> (1..1000, default 200) bounds one run. A run that
// reports batchFull=true has more candidates; re-run until it is false. The
// flag is declared in the command spec so the harness parses and clamps it —
// a hand-rolled --batch was rejected as an unknown flag before the script ever
// saw it, which capped a 102,045-row drain at 200 rows per invocation on
// 2026-09-01 and made it ~510 separate runs.
//
// Requires DATABASE_URL. The invocation is audited by the harness
// (policy_decision_audit, actorType/executionKind 'operator').

import { getDb } from '../../src/shared/db'
import { createGoogleContentAuthorityRepository } from '../../src/contexts/identity/infrastructure/repositories/google-content-authority.repository'
import {
  createExecutionPermitStartDeadlineSweeper,
  EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE,
} from '../../src/shared/auth/execution-permit-start-deadline-sweep'
import { GOOGLE_CONTENT_CAPABILITIES } from '../../src/shared/auth/google-content-contract'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:permit-start-deadline-fence'
const USAGE = `pnpm ${COMMAND_NAME} --operator <id> [--batch-size <n>] [--reason <text> --apply --yes ${COMMAND_NAME}]`
const MAX_BATCH = 1_000

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation: true,
      destructive: false,
      capability: undefined,
      batchSize: {
        default: EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE,
        max: MAX_BATCH,
      },
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const store = createGoogleContentAuthorityRepository(getDb())
      const clock = () => new Date()
      // The harness owns the flag: it parses --batch-size, clamps it to the
      // spec's max and applies the default, so there is one bound rather than
      // two that can disagree.
      const batchSize = ctx.batchSize ?? EXECUTION_PERMIT_START_DEADLINE_SWEEP_BATCH_SIZE

      if (ctx.dryRun) {
        // Same predicate the sweeper scans with — selection only, no lock, no
        // write. Reports the count, never a permit id / organization / property.
        const candidates = await store.transaction((tx) =>
          store.listElapsedAdmittedPermitIds(tx, {
            capabilities: GOOGLE_CONTENT_CAPABILITIES,
            before: clock(),
            limit: batchSize,
          }),
        )
        io.out(
          JSON.stringify(
            {
              command: COMMAND_NAME,
              mode: 'dry-run',
              batchSize,
              candidates: candidates.length,
              batchFull: candidates.length >= batchSize,
            },
            null,
            2,
          ),
        )
        io.out(
          `would fence ${candidates.length} admitted permit(s) past start_deadline_at — re-run with --apply --yes ${COMMAND_NAME}`,
        )
        return
      }

      const outcome = await createExecutionPermitStartDeadlineSweeper({
        store,
        clock,
        batchSize,
      })()
      io.out(
        JSON.stringify({ command: COMMAND_NAME, mode: 'apply', ...outcome }, null, 2),
      )
      if (outcome.batchFull) {
        io.out('batchFull=true — more candidates remain; re-run until batchFull=false')
      }
      io.out(
        'evidence: the decision row in policy_decision_audit plus this outcome — attach to the ticket',
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error(`${COMMAND_NAME} failed`, err)
  process.exit(1)
})
