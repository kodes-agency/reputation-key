// The operator command contract for recording the analysis sequences a past
// leak left behind:
//
//   pnpm ops ai release-orphan-sequences <propertyId> --operator <id>
//     [--reason <text> --apply]
//
// What an orphan is, and why the apply is safe, lives in
// src/shared/db/review-analysis-orphan-sequences.ts. This module is the
// invocation: the spec the harness runs it under, the arguments, and what it
// prints. It sits here, not in `scripts/ops/`, because `scripts/**` is wiring
// only.
//
// The harness stores neither the operator nor the reason, and the ledger row
// keeps only the reason code `operator_repair`. So the printed record is the
// audit trail: an applied run prints the operator, the reason, the correlation
// id and the sequences it recorded, and the operator copies it into the
// incident record. Every line is ids, numbers and instants: no Review text.

import type {
  OrphanSequenceRelease,
  OrphanSequenceScan,
} from '#/shared/db/review-analysis-orphan-sequences'
import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const COMMAND = 'ops:ai'
const ACTION = 'release-orphan-sequences'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A mutation, so it reports by default and `--apply` needs a reason. Not
 * destructive: it adds ledger rows, deletes nothing, and a row it adds only
 * stops coverage waiting for a number nothing can settle.
 */
export const aiReleaseOrphanSequencesCommandSpec: OperatorCommandSpec = Object.freeze({
  name: COMMAND,
  scope: 'global',
  mutation: true,
  usage: `pnpm ops ai ${ACTION} <propertyId> --operator <id> [--reason <text> --apply]`,
})

type Plan =
  Readonly<{ ok: true; propertyId: string }> | Readonly<{ ok: false; error: string }>

export function planAiReleaseOrphanSequences(args: OperatorArgs): Plan {
  const [action, propertyId, ...extra] = args.positionals
  if (action !== ACTION) return { ok: false, error: `the only action is '${ACTION}'` }
  if (!propertyId) return { ok: false, error: '<propertyId> is required' }
  if (!UUID.test(propertyId)) return { ok: false, error: '<propertyId> must be a UUID' }
  if (extra.length > 0) return { ok: false, error: 'one <propertyId> at a time' }
  return { ok: true, propertyId: propertyId.toLowerCase() }
}

export type OrphanSequenceStore = Readonly<{
  scan: (propertyId: string) => Promise<OrphanSequenceScan>
  release: (propertyId: string) => Promise<OrphanSequenceRelease>
}>

type Refusal = Exclude<OrphanSequenceScan, Readonly<{ status: 'scanned' }>>

function printRefusal(io: OperatorIO, refusal: Refusal): void {
  io.out(JSON.stringify({ outcome: refusal.status, ...refusal }, null, 2))
  switch (refusal.status) {
    case 'property_not_found':
      io.err('refused: no Property has that id')
      return
    case 'not_enabled':
      io.err(
        'refused: the Property has no enabled Review Analysis authorization at its current ' +
          'source epoch, so no settlement is awaited and there is nothing to release',
      )
      return
    case 'no_head':
      io.err('refused: the Property has no analysis head for its current source epoch')
      return
    case 'range_too_wide':
      io.err(
        `refused: ${String(refusal.range)} sequences lie between the start and the head. ` +
          'This command is for a few leaked numbers; a range this wide needs a person to look at it',
      )
      return
    case 'head_recently_updated':
      io.err(
        `refused: the analysis head moved at ${refusal.headUpdatedAt.toISOString()}. ` +
          'Work that was given a number may not have announced it yet. ' +
          `Run again after ${refusal.quietAfter.toISOString()}`,
      )
      return
  }
}

function describe(scan: Extract<OrphanSequenceScan, Readonly<{ status: 'scanned' }>>) {
  return {
    propertyId: scan.propertyId,
    organizationId: scan.organizationId,
    sourceEpoch: scan.sourceEpoch,
    reviewAnalysisEpoch: scan.reviewAnalysisEpoch,
    analysisStartSequence: scan.analysisStartSequence,
    headSequence: scan.headSequence,
    // Why every sequence of the range is or is not a candidate.
    breakdown: scan.breakdown,
    orphans: scan.orphans,
  }
}

const WHY_ORPHAN =
  'an orphan has no settlement, no Review holding it, no outbox fact naming it, and is not released'

async function report(
  io: OperatorIO,
  store: OrphanSequenceStore,
  propertyId: string,
): Promise<number> {
  const scan = await store.scan(propertyId)
  if (scan.status !== 'scanned') {
    printRefusal(io, scan)
    return 1
  }
  io.out(JSON.stringify({ outcome: 'would_release', ...describe(scan) }, null, 2))
  io.out(
    scan.orphans.length === 0
      ? 'report only — nothing to release'
      : `report only — ${String(scan.orphans.length)} orphan sequence(s) (${WHY_ORPHAN}). ` +
          'Re-run with --reason <text> --apply to record them as released.',
  )
  return 0
}

type RunInput = Readonly<{
  ctx: Pick<OperatorContext, 'dryRun' | 'operatorId' | 'correlationId' | 'reason'>
  propertyId: string
  store: OrphanSequenceStore
  io: OperatorIO
}>

/** Report, or with `--apply` record the orphans. Returns the exit code: 1 when refused. */
export async function runAiReleaseOrphanSequences(input: RunInput): Promise<number> {
  const { ctx, propertyId, store, io } = input
  if (ctx.dryRun) return report(io, store, propertyId)

  const result = await store.release(propertyId)
  if (result.status !== 'released') {
    printRefusal(io, result)
    return 1
  }
  io.out(
    JSON.stringify(
      {
        outcome: result.recorded === 0 ? 'nothing_to_release' : 'released',
        operator: ctx.operatorId,
        reason: ctx.reason,
        correlationId: ctx.correlationId,
        recorded: result.recorded,
        ...describe(result.scan),
      },
      null,
      2,
    ),
  )
  return 0
}
