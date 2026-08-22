// ops:ai-reanalyze — audited replay of already-stored reviews through AI
// review analysis.
//
// `analysis_start_sequence` is a deliberate watermark: enabling AI skips every
// review the property already held, so history is never analysed by accident.
// Until this command existed the only way to reprocess it was to delete the
// property and reimport it — destroying the reviews to re-derive their
// analysis. This makes the defeat explicit, audited and gap-free instead of
// implicit.
//
// It CANNOT grant consent. It refuses unless the merchant is already `enabled`
// for `review_analysis` on the property's current source epoch; consent is
// theirs, taken on the AI data-use surface with a password.
//
// Cost: every backfilled review is a real provider call. Dry-run is the
// default and prints the exact review count and the sequence range that would
// be emitted; `--apply` additionally requires `--ticket` and the typed
// confirmation `--yes ops:ai-reanalyze`. `--batch-size` caps a pilot run.

import { createHash } from 'node:crypto'
import { getDb } from '../../src/shared/db'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import { createReviewAnalysisBackfillAdapter } from '../../src/contexts/ai/infrastructure/adapters/ai-review-analysis-backfill.adapter'
import { createBackfillReviewAnalysis } from '../../src/contexts/ai/application/use-cases/backfill-review-analysis'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:ai-reanalyze'
const USAGE =
  'pnpm ops:ai-reanalyze --operator <id> --org <id> --property <uuid> [--batch-size <n>] [--reason <text> --ticket <ref> --apply --yes ops:ai-reanalyze]'
const REASON_CODE = 'operator_review_analysis_backfill'
const BATCH = { default: 500, max: 5_000 } as const

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'property',
      // The capability the replayed work depends on: a killed or suspended
      // review-analysis capability must stop this command too.
      capability: 'ai.analyze',
      mutation: true,
      // Every replayed review is a paid provider call and the run bumps the
      // merchant's review-analysis epoch, superseding the live analysis
      // generation. Typed confirmation is not ceremony here.
      destructive: true,
      requiresTicket: true,
      batchSize: BATCH,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const limit = ctx.batchSize ?? BATCH.default
      const requestHash = createHash('sha256')
        .update(
          [
            COMMAND_NAME,
            ctx.operatorId,
            ctx.organizationId,
            ctx.propertyId,
            ctx.ticket ?? '',
            String(limit),
          ].join('\u0000'),
        )
        .digest('hex')
      // Derived from the ticketed intent, NOT the per-invocation correlation
      // id: a retry of the same ticket must not burn a second review-analysis
      // epoch. On replay the reposition returns the already-recorded start,
      // which no longer equals the (now advanced) head, so the use case aborts
      // the whole transaction loudly instead of double-backfilling.
      const idempotencyKey = `ops-ai-reanalyze:${requestHash.slice(0, 48)}`

      const backfill = createBackfillReviewAnalysis({
        backfillStore: createReviewAnalysisBackfillAdapter(getDb()),
      })
      const outcome = await backfill({
        organizationId: organizationId(ctx.organizationId as string),
        propertyId: propertyId(ctx.propertyId as string),
        limit,
        dryRun: ctx.dryRun,
        reasonCode: REASON_CODE,
        idempotencyKey,
        requestHash,
        correlationId: ctx.correlationId,
        occurredAt: new Date(),
      })

      if (outcome.status === 'refused') {
        io.err(
          JSON.stringify(
            {
              action: 'refused',
              precondition: outcome.refusal,
              detail: outcome.message,
              organizationId: ctx.organizationId,
              propertyId: ctx.propertyId,
            },
            null,
            2,
          ),
        )
        return 1
      }

      if (outcome.status === 'planned') {
        io.out(
          JSON.stringify(
            {
              action: 'would_backfill',
              organizationId: ctx.organizationId,
              propertyId: ctx.propertyId,
              ...outcome.plan,
              providerCalls: outcome.plan.selectedReviewCount,
              sequenceRange: `${outcome.plan.firstAnalysisSequence}..${outcome.plan.lastAnalysisSequence}`,
            },
            null,
            2,
          ),
        )
        if (outcome.plan.capped) {
          io.out(
            `capped at --batch-size ${limit} of ${outcome.plan.eligibleReviewCount} eligible reviews — ` +
              'a capped run creates an analysis epoch covering ONLY the selected reviews, and a later full run supersedes it with another epoch',
          )
        }
        if (outcome.plan.supersededDailyAggregateRows > 0) {
          io.out(
            `starts a new aggregate series at review-analysis epoch ${outcome.plan.nextReviewAnalysisEpoch} — ` +
              `${outcome.plan.supersededDailyAggregateRows} existing daily aggregate rows under epoch ${outcome.plan.currentReviewAnalysisEpoch} become historical, ` +
              'and property reads follow the new series from the moment this applies',
          )
        }
        io.out(
          `${outcome.plan.selectedReviewCount} provider calls would be made — re-run with --apply --ticket <ref> --yes ${COMMAND_NAME}`,
        )
        return
      }

      io.out(
        JSON.stringify(
          {
            action: 'backfilled',
            organizationId: ctx.organizationId,
            propertyId: ctx.propertyId,
            ...outcome.plan,
            reviewAnalysisEpoch: outcome.reviewAnalysisEpoch,
            analysisStartSequence: outcome.analysisStartSequence,
            stateVersion: outcome.stateVersion,
            // The MEMBER whose consent this replayed. The operator who ran it is
            // recorded by the harness (identity, ticket, correlation id) and by
            // reason_code — the consent ledger's actor is a merchant concept,
            // and admission resolves it as a member."userId".
            consentActorUserId: outcome.consentActorUserId,
            emittedCount: outcome.emittedAnalysisSequences.length,
            sequenceRange: `${outcome.emittedAnalysisSequences[0]}..${outcome.emittedAnalysisSequences.at(-1)}`,
          },
          null,
          2,
        ),
      )
    },
    argv,
  )
  process.exit(result.exitCode)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
  process.exit(1)
})
