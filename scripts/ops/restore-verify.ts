// Operator CLI (BQC-7.8): restore VERIFY — the restore drill's
// purge-before-serving proof, run INSIDE the isolated restored environment
// (runbook §8, docs/operations/backup-and-lifecycle.md). This is the step
// after ops:restore-preflight: the environment booted in isolated mode
// (RESTORE_MODE=isolated; worker down; web capabilities deny fail-closed)
// now runs the source-policy purge and proves zero expired-content rows
// remain eligible.
//
//   - Hard gates: RESTORE_MODE=isolated in this env AND an isolated
//     (loopback) DATABASE_URL — the command refuses otherwise, before work.
//   - The purge runs IN-PROCESS through the same execution path the
//     purge-expired-reviews job uses (handler core over the real repos —
//     never a BullMQ enqueue; the drill has no worker), writing the normal
//     retention_runs evidence (subject 'reviews.purge').
//
// DESTRUCTIVE: deletes expired source content (bounded, evidence-writing).
// --apply requires --reason + the typed confirmation --yes ops:restore-verify.
//
// Usage:
//   pnpm ops:restore-verify --operator <id>            — dry-run report
//   pnpm ops:restore-verify --operator <id> --reason <text> --apply --yes ops:restore-verify
//
// Requires DATABASE_URL (pointed at the ISOLATED restore target) and
// RESTORE_MODE=isolated. Policy-evaluated + audited like every operator
// command. Cutover afterwards = UNSET RESTORE_MODE + redeploy.

import { sql } from 'drizzle-orm'
import { getContainer } from '../../src/composition'
import { getEnv } from '../../src/shared/config/env'
import { createAtomicReplyCommandStore } from '../../src/contexts/review/infrastructure/reply-command-store'
import { createPurgeExpiredReviewsHandler } from '../../src/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import {
  RESTORE_VERIFY_PURGE_SUBJECT,
  RESTORE_VERIFY_SPEC,
  runRestoreVerifyAction,
  type RestoreVerifyEvidenceRow,
} from '../../src/shared/ops/restore-verify'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(RESTORE_VERIFY_SPEC, async (ctx, _args, io) => {
    const env = getEnv()
    const container = getContainer()

    // The same construction the worker's bootstrap uses for the scheduled
    // purge (bootstrap.ts) — one shared atomic command store, the job
    // handler core invoked directly (the drill has no BullMQ).
    const commandStore = createAtomicReplyCommandStore(container.db, container.eventBus)
    const purgeHandler = createPurgeExpiredReviewsHandler({
      reviewRepo: container.reviewRepo,
      commandStore,
      clock: container.clock,
      db: container.db,
    })

    return runRestoreVerifyAction(
      ctx,
      {
        env,
        countExpired: async () =>
          (
            await container.reviewRepo.findAllExpiredBeforeAcrossTenants(
              container.clock(),
            )
          ).length,
        purgeExpired: async () => {
          await purgeHandler({} as never)
        },
        purgeEvidence: async (): Promise<ReadonlyArray<RestoreVerifyEvidenceRow>> => {
          const rows = await container.db.execute(sql`
            SELECT subject, rows_deleted, outcome, started_at
            FROM retention_runs
            WHERE subject = ${RESTORE_VERIFY_PURGE_SUBJECT}
            ORDER BY started_at DESC
            LIMIT 5
          `)
          return rows.rows.map((row) => {
            const r = row as {
              subject: string
              rows_deleted: number
              outcome: string
              started_at: Date | string
            }
            return {
              subject: r.subject,
              rowsDeleted: r.rows_deleted,
              outcome: r.outcome,
              startedAt:
                r.started_at instanceof Date
                  ? r.started_at.toISOString()
                  : String(r.started_at),
            }
          })
        },
      },
      io,
    )
  })
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:restore-verify failed', err)
  process.exit(1)
})
