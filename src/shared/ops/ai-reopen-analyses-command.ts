// The operator command contract for analysing again the reviews the automatic
// reopen gave up on:
//
//   pnpm ops ai-reopen-analyses <propertyId|all> --operator <id>
//     [--batch-size <n>] [--reason <text> --apply]
//
// The sweep reopens a review whose analysis failed for a reason that says
// nothing about the review, at most three times (ADR 0058). A cause that lasts
// longer than that, such as the provider account running out of credit on
// 2026-10-24, uses the budget up and leaves the review settled as not
// analysable for good. Once the cause is fixed, this command gives those
// reviews a fresh analysis sequence through the sweep's own path. The rules
// live in the AI context's reopen adapter; this module is the invocation, and
// `scripts/ops/` binds the two.
//
// The harness stores neither the operator nor the reason, so the printed record
// is the audit trail: an applied run prints the operator, the reason, the
// correlation id and every review it reopened, and the operator copies it into
// the incident record. Every line is ids, numbers, codes and instants: no
// Review text.

import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const COMMAND = 'ops:ai-reopen-analyses'
const ALL = 'all'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A mutation, so it reports by default and `--apply` needs a reason. Not
 * destructive: it moves each review to a new sequence and publishes an event,
 * the same writes the automatic reopen makes, and deletes nothing.
 */
export const aiReopenAnalysesCommandSpec: OperatorCommandSpec = Object.freeze({
  name: COMMAND,
  scope: 'global',
  mutation: true,
  batchSize: Object.freeze({ default: 200, max: 1_000 }),
  usage:
    'pnpm ops ai-reopen-analyses <propertyId|all> --operator <id> ' +
    '[--batch-size <n>] [--reason <text> --apply]',
})

type Plan =
  | Readonly<{ ok: true; propertyId: string | null }>
  | Readonly<{ ok: false; error: string }>

export function planAiReopenAnalyses(args: OperatorArgs): Plan {
  const [target, ...extra] = args.positionals
  if (!target) return { ok: false, error: `<propertyId> or '${ALL}' is required` }
  if (extra.length > 0) return { ok: false, error: `one <propertyId> or '${ALL}'` }
  if (target === ALL) return { ok: true, propertyId: null }
  if (!UUID.test(target)) {
    return { ok: false, error: `<propertyId> must be a UUID or '${ALL}'` }
  }
  return { ok: true, propertyId: target.toLowerCase() }
}

type Scope = Readonly<{ organizationId: string; propertyId: string }>

export type SpentAnalysisRow = Scope &
  Readonly<{
    reviewId: string
    operationId: string
    failureCode: string
    failedAt: Date
    analysisSequence: number
  }>

export type ReopenedAnalysisRow = Scope &
  Readonly<{
    reviewId: string
    operationId: string
    previousSequence: number
    analysisSequence: number
  }>

export type FailedPropertyRow = Scope & Readonly<{ reason: string }>

export type SpentAnalysisStore = Readonly<{
  /**
   * Whether the global, provider and Review Analysis execution controls all
   * accept work. Under a stop a reopened review could only wait in the backlog,
   * so the sweep reopens nothing then, and neither does this command.
   */
  accepting: () => Promise<boolean>
  list: (
    input: Readonly<{ propertyId: string | null; limit: number }>,
  ) => Promise<ReadonlyArray<SpentAnalysisRow>>
  reopen: (
    input: Readonly<{ propertyId: string | null; limit: number; occurredAt: Date }>,
  ) => Promise<
    Readonly<{
      reopened: ReadonlyArray<ReopenedAnalysisRow>
      failed: ReadonlyArray<FailedPropertyRow>
    }>
  >
}>

function countByProperty(rows: ReadonlyArray<Scope>): Record<string, number> {
  return rows.reduce<Record<string, number>>(
    (counts, row) => ({ ...counts, [row.propertyId]: (counts[row.propertyId] ?? 0) + 1 }),
    {},
  )
}

const WHY_SPENT =
  'each failed for a reason about the provider or the platform, not the review, ' +
  'until its automatic reopens ran out'

type RunInput = Readonly<{
  ctx: Pick<
    OperatorContext,
    'dryRun' | 'operatorId' | 'correlationId' | 'reason' | 'batchSize'
  >
  propertyId: string | null
  store: SpentAnalysisStore
  io: OperatorIO
  now?: () => Date
}>

const STOPPED =
  'AI execution is stopped (the global, provider or Review Analysis control does not ' +
  'accept work), so a reopened review could only wait in the backlog. Restore execution first'

/**
 * Report, or with `--apply` reopen. Returns the exit code: 1 when refused or
 * when a Property failed (the others stay reopened and are printed).
 */
export async function runAiReopenAnalyses(input: RunInput): Promise<number> {
  const { ctx, propertyId, store, io } = input
  const limit = ctx.batchSize ?? aiReopenAnalysesCommandSpec.batchSize?.default ?? 200
  const target = propertyId ?? ALL
  const accepting = await store.accepting()

  if (ctx.dryRun) {
    const spent = await store.list({ propertyId, limit })
    io.out(
      JSON.stringify(
        {
          outcome: 'would_reopen',
          target,
          limit,
          executionAccepting: accepting,
          candidates: spent.length,
          byProperty: countByProperty(spent),
          reviews: spent.map((row) => ({
            ...row,
            failedAt: row.failedAt.toISOString(),
          })),
        },
        null,
        2,
      ),
    )
    io.out(
      spent.length === 0
        ? 'report only — no review is waiting for an operator reopen'
        : `report only — ${String(spent.length)} review(s) (${WHY_SPENT}). ` +
            'Fix the cause first, then re-run with --reason <text> --apply.',
    )
    if (!accepting) io.err(`note: ${STOPPED}; --apply is refused until then`)
    return 0
  }

  if (!accepting) {
    io.out(JSON.stringify({ outcome: 'execution_stopped', target }, null, 2))
    io.err(`refused: ${STOPPED}`)
    return 1
  }
  const { reopened, failed } = await store.reopen({
    propertyId,
    limit,
    occurredAt: (input.now ?? (() => new Date()))(),
  })
  io.out(
    JSON.stringify(
      {
        outcome: reopened.length === 0 ? 'nothing_to_reopen' : 'reopened',
        operator: ctx.operatorId,
        reason: ctx.reason,
        correlationId: ctx.correlationId,
        target,
        reopened: reopened.length,
        byProperty: countByProperty(reopened),
        reviews: reopened,
        failedProperties: failed,
      },
      null,
      2,
    ),
  )
  if (failed.length === 0) return 0
  io.err(
    `${String(failed.length)} Property(ies) failed; the reviews above were reopened. ` +
      'Re-run to retry the rest: a second run selects only what is still spent.',
  )
  return 1
}
