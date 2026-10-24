// Operator CLI: delete the repeated Review source observations the old writer
// stored, one per read, before 2026-10-24.
//
// Usage:
//   pnpm ops review-observations prune --operator <id> [--org <id>] [--batch-size <n>]
//     — count the repeats, Review batch by Review batch (writes nothing)
//   pnpm ops review-observations prune --operator <id> [--org <id>] \
//     --reason <text> --yes ops:review-observations --apply
//
// A repeat is an `unchanged` observation that is not its Review's newest and
// matches the applied row before it exactly; deleting it changes no reader's
// answer (ADR 0055, note 2026-10-24 (b)). The rules live in the Review
// repository and the invocation in src/shared/ops/review-observations-command.ts
// — scripts/ is wiring only. Requires DATABASE_URL (+ QUEUE_REDIS_URL for the
// harness).

import { getDb } from '../../src/shared/db'
import {
  closeRetentionRun,
  failRetentionRun,
  openRetentionRun,
} from '../../src/shared/db/retention/evidence'
import { organizationId, reviewId } from '../../src/shared/domain/ids'
import {
  planReviewObservations,
  REVIEW_OBSERVATION_REPEATS_SUBJECT,
  reviewObservationsCommandSpec,
  runReviewObservationsPrune,
} from '../../src/shared/ops/review-observations-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    reviewObservationsCommandSpec,
    async (ctx, args, io) => {
      const plan = planReviewObservations(args)
      if (!plan.ok) {
        io.err(`${reviewObservationsCommandSpec.name}: ${plan.error}`)
        io.err(`usage: ${reviewObservationsCommandSpec.usage}`)
        return 1
      }
      const db = getDb()
      const retention = ctx.container.reviewMaintenanceRuntime.observationRetention
      const request = (input: {
        after: string | null
        limit: number
        organizationId?: string
      }) => ({
        after: input.after === null ? null : reviewId(input.after),
        limit: input.limit,
        ...(input.organizationId === undefined
          ? {}
          : { scope: { organizationId: organizationId(input.organizationId) } }),
      })
      return runReviewObservationsPrune({
        ctx,
        store: {
          scan: (input) => retention.scanRepeats(request(input)),
          prune: (input) => retention.pruneRepeats(request(input)),
          openEvidence: (batchSize) =>
            openRetentionRun(
              db,
              REVIEW_OBSERVATION_REPEATS_SUBJECT,
              batchSize,
              new Date(),
            ),
          closeEvidence: (id, done) =>
            closeRetentionRun(db, id, {
              finishedAt: new Date(),
              batches: done.batches,
              rowsDeleted: done.rowsDeleted,
              outcome: 'completed',
            }),
          failEvidence: (id, error) => failRetentionRun(db, id, new Date(), error),
        },
        io,
      })
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:review-observations failed', err)
  process.exit(1)
})
