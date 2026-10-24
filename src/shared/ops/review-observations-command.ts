// The operator command contract for the one-off prune of repeated Review
// source observations (ADR 0055, note 2026-10-24 (b)):
//
//   pnpm ops review-observations prune --operator <id> [--org <id>] [--batch-size <n>]
//     [--reason <text> --yes ops:review-observations --apply]
//
// Until 2026-10-24 every read of a review wrote a full-text observation row, so
// the beta held 3,425,776 rows for 12,599 Reviews, 3,400,389 of them a repeat of
// the row before. What a repeat is, and why deleting it changes no reader's
// answer, lives in the Review repository
// (src/contexts/review/infrastructure/repositories/observation-retention.repository.ts).
// This module is the invocation: the spec, the walk over the Reviews in batches,
// the evidence record and what it prints. It sits here, not in `scripts/ops/`,
// because `scripts/**` is wiring only.
//
// A dry run is the default and counts the same batches it would delete. An
// applied run writes one content-free retention_runs row (subject
// `review_source_observations.repeats`) with the number of batches and rows
// deleted. Each batch is one statement, so a run stopped part-way leaves only
// whole batches done; it prints the last Review it finished, and a re-run
// finds nothing more in the Reviews it already covered. Every line is counts,
// ids and instants: no Review text.

import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const ACTION = 'prune'
const PROGRESS_EVERY_BATCHES = 10

export const REVIEW_OBSERVATION_REPEATS_SUBJECT = 'review_source_observations.repeats'

/** Deletes rows, so --apply also needs the typed command name. */
export const reviewObservationsCommandSpec: OperatorCommandSpec = Object.freeze({
  name: 'ops:review-observations',
  scope: 'global',
  mutation: true,
  destructive: true,
  // One pass over the table per batch; one batch covers the beta (the
  // repository's MAX_REPEAT_BATCH_REVIEWS says why).
  batchSize: { default: 20_000, max: 20_000 },
  usage:
    'pnpm ops review-observations prune --operator <id> [--org <id>] [--batch-size <n>] ' +
    '[--reason <text> --yes ops:review-observations --apply]',
})

type Plan = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>

export function planReviewObservations(args: OperatorArgs): Plan {
  const [action, ...extra] = args.positionals
  if (action !== ACTION) return { ok: false, error: `the only action is '${ACTION}'` }
  if (extra.length > 0) return { ok: false, error: `'${ACTION}' takes no argument` }
  return { ok: true }
}

/** One batch of Reviews, as the Review repository reports it. */
export type RepeatBatchResult = Readonly<{
  reviews: number
  observations: number
  repeats: number
  last: string | null
}>

type RepeatBatchRequest = Readonly<{
  after: string | null
  limit: number
  organizationId?: string
}>

export type RepeatPruneStore = Readonly<{
  scan: (input: RepeatBatchRequest) => Promise<RepeatBatchResult>
  prune: (input: RepeatBatchRequest) => Promise<RepeatBatchResult>
  /** Opens the evidence row; returns its id. */
  openEvidence: (batchSize: number) => Promise<string>
  closeEvidence: (
    id: string,
    result: Readonly<{ batches: number; rowsDeleted: number }>,
  ) => Promise<void>
  failEvidence: (id: string, error: unknown) => Promise<void>
}>

type Totals = Readonly<{
  batches: number
  reviews: number
  observations: number
  repeats: number
  last: string | null
}>

const NO_TOTALS: Totals = {
  batches: 0,
  reviews: 0,
  observations: 0,
  repeats: 0,
  last: null,
}

function addBatch(totals: Totals, batch: RepeatBatchResult): Totals {
  return {
    batches: totals.batches + 1,
    reviews: totals.reviews + batch.reviews,
    observations: totals.observations + batch.observations,
    repeats: totals.repeats + batch.repeats,
    last: batch.last,
  }
}

type RunInput = Readonly<{
  ctx: Pick<
    OperatorContext,
    'dryRun' | 'operatorId' | 'correlationId' | 'reason' | 'organizationId' | 'batchSize'
  >
  store: RepeatPruneStore
  io: OperatorIO
}>

const DEFAULT_BATCH_REVIEWS = reviewObservationsCommandSpec.batchSize!.default

function summary(ctx: RunInput['ctx'], totals: Totals) {
  return {
    organizationId: ctx.organizationId ?? 'all',
    reviews: totals.reviews,
    observations: totals.observations,
    repeats: totals.repeats,
    kept: totals.observations - totals.repeats,
    batches: totals.batches,
  }
}

type Walk = Readonly<{ totals: Totals; error: unknown }>

/** Walk every batch of Reviews once, scanning or pruning each. A failed batch
 * ends the walk with the totals of the batches before it. */
async function walk(
  batch: RepeatPruneStore['scan'],
  ctx: RunInput['ctx'],
  io: OperatorIO,
): Promise<Walk> {
  const limit = ctx.batchSize ?? DEFAULT_BATCH_REVIEWS
  let totals = NO_TOTALS
  try {
    for (;;) {
      const result = await batch({
        after: totals.last,
        limit,
        ...(ctx.organizationId === undefined
          ? {}
          : { organizationId: ctx.organizationId }),
      })
      if (result.reviews === 0) return { totals, error: null }
      totals = addBatch(totals, result)
      if (totals.batches % PROGRESS_EVERY_BATCHES === 0) {
        io.out(
          `progress: ${String(totals.batches)} batches, ${String(totals.reviews)} reviews, ` +
            `${String(totals.repeats)} repeats`,
        )
      }
    }
  } catch (error) {
    return { totals, error }
  }
}

/** Report, or with `--apply` delete, the repeats. Returns the exit code. */
export async function runReviewObservationsPrune(input: RunInput): Promise<number> {
  const { ctx, store, io } = input

  if (ctx.dryRun) {
    const { totals, error } = await walk(store.scan, ctx, io)
    if (error !== null) throw error
    io.out(JSON.stringify({ outcome: 'would_delete', ...summary(ctx, totals) }, null, 2))
    io.out(
      totals.repeats === 0
        ? 'report only — no repeated observation to delete'
        : `report only — ${String(totals.repeats)} of ${String(totals.observations)} ` +
            'observation rows repeat the row before them. Re-run with --reason <text> ' +
            `--yes ${reviewObservationsCommandSpec.name} --apply to delete them.`,
    )
    return 0
  }

  const evidenceId = await store.openEvidence(ctx.batchSize ?? DEFAULT_BATCH_REVIEWS)
  const { totals, error } = await walk(store.prune, ctx, io)
  if (error !== null) {
    await store.failEvidence(evidenceId, error)
    io.out(
      JSON.stringify(
        { outcome: 'failed', ...summary(ctx, totals), resumeAfter: totals.last },
        null,
        2,
      ),
    )
    io.err(
      `stopped: ${error instanceof Error ? error.message : String(error)}. ` +
        'The batches before it are deleted; a re-run continues safely.',
    )
    return 1
  }
  await store.closeEvidence(evidenceId, {
    batches: totals.batches,
    rowsDeleted: totals.repeats,
  })
  io.out(
    JSON.stringify(
      {
        outcome: 'deleted',
        ...summary(ctx, totals),
        operator: ctx.operatorId,
        reason: ctx.reason ?? null,
        correlationId: ctx.correlationId,
        evidenceSubject: REVIEW_OBSERVATION_REPEATS_SUBJECT,
      },
      null,
      2,
    ),
  )
  return 0
}
