// The operator command contract for copying the Handling Cycle facts onto the
// Inbox rows:
//
//   pnpm ops inbox-cycle-facts backfill --operator <id> [--batch-size <n>]
//     [--reason <text> --apply]
//
// `inbox_items` carries the current cycle number, source revision and state
// revision beside the Handling Cycle head (migration 0158); the migration adds
// the columns and this command fills them from the heads, one bounded batch at a
// time in item order. Safe to run again: a batch only covers the rows whose facts
// differ from their head's, and a second apply finds nothing. It writes no other
// column and deletes nothing. Every line is counts and ids.

import {
  planActionOnly,
  type OperatorArgs,
  type OperatorCommandSpec,
  type OperatorContext,
  type OperatorIO,
} from './operator-command'

const ACTION = 'backfill'
const PROGRESS_EVERY_BATCHES = 10

export type CycleHeadFactsBatch = Readonly<{
  /** Rows whose facts differ from their head's. */
  rows: number
  /** The last item id the batch covered, null when it covered none. */
  last: string | null
}>

export type CycleHeadFactsParity = Readonly<{
  items: number
  withHead: number
  factsDiffer: number
  statusDiffers: number
}>

type BatchRequest = Readonly<{ after: string | null; limit: number }>

/** The Inbox capability the command is written against: plain ids and counts. */
export type CycleHeadFactsStore = Readonly<{
  parity: () => Promise<CycleHeadFactsParity>
  scan: (input: BatchRequest) => Promise<CycleHeadFactsBatch>
  backfill: (input: BatchRequest) => Promise<CycleHeadFactsBatch>
}>

/** A mutation, so it reports by default and `--apply` needs a reason. Not destructive. */
export const inboxCycleFactsCommandSpec: OperatorCommandSpec = Object.freeze({
  name: 'ops:inbox-cycle-facts',
  scope: 'global',
  mutation: true,
  batchSize: { default: 1_000, max: 5_000 },
  usage:
    'pnpm ops inbox-cycle-facts backfill --operator <id> [--batch-size <n>] ' +
    '[--reason <text> --apply]',
})

type Plan = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>

export function planInboxCycleFacts(args: OperatorArgs): Plan {
  return planActionOnly(args, ACTION)
}

type RunInput = Readonly<{
  ctx: Pick<
    OperatorContext,
    'dryRun' | 'operatorId' | 'correlationId' | 'reason' | 'batchSize'
  >
  store: CycleHeadFactsStore
  io: OperatorIO
}>

const DEFAULT_BATCH = inboxCycleFactsCommandSpec.batchSize!.default

type Walk = Readonly<{ batches: number; rows: number; last: string | null }>

async function walk(
  batch: CycleHeadFactsStore['scan'],
  limit: number,
  io: OperatorIO,
): Promise<Walk> {
  let done: Walk = { batches: 0, rows: 0, last: null }
  for (;;) {
    const result = await batch({ after: done.last, limit })
    if (result.last === null) return done
    done = {
      batches: done.batches + 1,
      rows: done.rows + result.rows,
      last: result.last,
    }
    if (done.batches % PROGRESS_EVERY_BATCHES === 0) {
      io.out(`progress: ${String(done.batches)} batches, ${String(done.rows)} rows`)
    }
  }
}

const describeParity = (parity: CycleHeadFactsParity) => ({
  items: parity.items,
  withHead: parity.withHead,
  factsDiffer: parity.factsDiffer,
  statusDiffers: parity.statusDiffers,
})

/** Report, or with `--apply` copy, the facts. Returns the exit code. */
export async function runInboxCycleFactsBackfill(input: RunInput): Promise<number> {
  const { ctx, store, io } = input
  const limit = ctx.batchSize ?? DEFAULT_BATCH

  if (ctx.dryRun) {
    const before = await store.parity()
    io.out(
      JSON.stringify({ outcome: 'would_backfill', ...describeParity(before) }, null, 2),
    )
    io.out(
      before.factsDiffer === 0
        ? 'report only — every Inbox row already carries its head’s facts'
        : `report only — ${String(before.factsDiffer)} Inbox row(s) differ from their head. ` +
            'Re-run with --reason <text> --apply to copy the facts.',
    )
    return 0
  }

  const written = await walk(store.backfill, limit, io)
  const after = await store.parity()
  io.out(
    JSON.stringify(
      {
        outcome: after.factsDiffer === 0 ? 'backfilled' : 'rows_remain',
        operator: ctx.operatorId,
        reason: ctx.reason ?? null,
        correlationId: ctx.correlationId,
        batches: written.batches,
        rowsCopied: written.rows,
        ...describeParity(after),
      },
      null,
      2,
    ),
  )
  return after.factsDiffer === 0 ? 0 : 1
}
