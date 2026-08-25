// Operator CLI (BQC-7.8): restore VERIFY — the restore drill's
// purge-before-serving proof, run INSIDE the isolated restored environment
// (runbook §8, docs/operations/backup-and-lifecycle.md). This is the step
// after ops:restore-preflight: the environment booted in isolated mode
// (RESTORE_MODE=isolated; worker down; web capabilities deny fail-closed)
// now runs every current retention lifecycle, invalidates restored authority,
// fences unpublished effects, and records a durable cell recovery generation.
//
//   - Hard gates: RESTORE_MODE=isolated in this env AND an attested loopback
//     or exact Railway PITR sibling DATABASE_URL — refusal happens before work.
//   - All work runs IN-PROCESS through the production repository/handler
//     paths — never a BullMQ enqueue; the drill has no worker.
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
// command. Cutover afterwards = pin the printed recovery run/generation,
// UNSET RESTORE_MODE, and redeploy; normal PITR sibling boot re-verifies it.

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
import {
  applyRecoveryFence,
  inspectRecoveryFence,
} from '../../src/shared/db/recovery/postgres-recovery-fence'
import {
  createRetentionSweepHandler,
  RETENTION_RULES,
} from '../../src/shared/jobs/retention-sweep.job'
import { countRetentionRuleCandidates } from '../../src/shared/db/retention/execute-retention-rule'
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
    const retentionHandler = createRetentionSweepHandler({
      db: container.db,
      clock: container.clock,
      rules: RETENTION_RULES,
    })

    return runRestoreVerifyAction(
      ctx,
      {
        env,
        countExpired: async () =>
          container.reviewRepo.countExpiredBeforeAcrossTenants(container.clock()),
        purgeExpired: async () => {
          await purgeHandler({} as never)
        },
        inspectGoogleImportLifecycle: async () => {
          const inspect = container.useCases.inspectGoogleImportV2Lifecycle
          if (!inspect) throw new Error('Google import lifecycle unavailable')
          return inspect()
        },
        sweepGoogleImportLifecycle: async () => {
          const sweep = container.useCases.sweepGoogleImportV2Lifecycle
          if (!sweep) throw new Error('Google import lifecycle unavailable')
          await sweep()
        },
        inspectRetentionBacklog: async () => {
          const now = container.clock()
          return Object.fromEntries(
            await Promise.all(
              RETENTION_RULES.map(
                async (rule) =>
                  [
                    rule.subject,
                    await countRetentionRuleCandidates(
                      container.db,
                      rule,
                      new Date(now.getTime() - rule.olderThanMs),
                    ),
                  ] as const,
              ),
            ),
          )
        },
        sweepRetentionBacklog: async () => {
          await retentionHandler({} as never)
        },
        inspectRecoveryFence: () => inspectRecoveryFence(container.db),
        applyRecoveryFence: (input) => applyRecoveryFence(container.db, input),
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
