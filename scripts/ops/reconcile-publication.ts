// Operator CLI (BQC-7.5): reconcile ambiguous Google reply publication via
// the reconcileReplyPublication use case (BQC-3.8). The use case re-reads
// provider state and heals provider-confirmed rows to published — it NEVER
// publishes.
//
// Usage:
//   pnpm ops:reconcile-publication <replyId> --operator <id> --org <id> [--reason <text> --apply]
//   pnpm ops:reconcile-publication --all-ambiguous --operator <id> [--batch-size <n>] [--reason <text> --apply]
//   pnpm ops:reconcile-publication --all-ambiguous --resume <token> --operator <id> [--reason <text> --apply]
//
// Bounded: a single reply, or ONE keyset page of due ambiguous rows per
// invocation (default 100, max 500). A full page reports partial and returns
// an opaque --resume token. Resuming preserves the original due-through
// boundary and starts strictly after the prior page; it must stay in the same
// dry-run/apply mode. Dry-run lists only; --apply re-reads provider truth.
// Requires DATABASE_URL.
// Identifier-only output (reply/org ids + outcomes) — content-free.

import { pathToFileURL } from 'node:url'
import { getContainer } from '../../src/composition'
import { organizationId, replyId } from '../../src/shared/domain/ids'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import type {
  AmbiguousPublicationReconciliationCandidate,
  FindAmbiguousPublicationReconciliationCandidates,
  ReconcileReplyPublication,
} from '../../src/contexts/review/application/public-api'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-publication [<replyId> --org <id> | --all-ambiguous [--resume <token>]] --operator <id> [--batch-size <n>] [--reason <text> --apply]'

const RESUME_VERSION = 1 as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type PublicationSweepCursor = Readonly<{
  mode: 'dry_run' | 'apply'
  dueThrough: Date
  reconcileDueAt: Date
  id: string
}>

type PublicationSweepDeps = Readonly<{
  findCandidates: FindAmbiguousPublicationReconciliationCandidates
  reconcile: ReconcileReplyPublication
  clock: () => Date
}>

type PublicationSweepInput = Readonly<{
  batchSize: number
  resumeToken: string | null
  dryRun: boolean
}>

export type PublicationSweepReport = Readonly<{
  mode: 'dry_run' | 'apply'
  /** Complete means the frozen due-through keyset was exhausted, not healed. */
  coverage: 'partial' | 'complete'
  coverageScope: 'frozen_due_through_keyset_segment'
  outcomeScope: 'current_page'
  dueThrough: string
  startedAfter: Readonly<{ reconcileDueAt: string; id: string }> | null
  seen: number
  attempted: number
  notEvaluated: number
  confirmedOnGoogle: number
  notConfirmed: number
  failed: number
  unresolvedInPage: number
  rows: ReadonlyArray<
    Readonly<{
      replyId: string
      organizationId: string
      reconcileDueAt: string
      outcome: 'not_evaluated' | 'confirmed_on_google' | 'not_confirmed' | 'failed'
      /** Typed use-case outcome/error code only; never provider or reply content. */
      detail: string | null
    }>
  >
  nextResumeToken: string | null
}>

type ResumePayload = Readonly<{
  v: typeof RESUME_VERSION
  mode: 'dry_run' | 'apply'
  dueThrough: string
  reconcileDueAt: string
  id: string
}>

function canonicalDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw new Error(`invalid publication sweep ${field}`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`invalid publication sweep ${field}`)
  }
  return parsed
}

export function encodePublicationSweepResume(cursor: PublicationSweepCursor): string {
  const payload: ResumePayload = {
    v: RESUME_VERSION,
    mode: cursor.mode,
    dueThrough: cursor.dueThrough.toISOString(),
    reconcileDueAt: cursor.reconcileDueAt.toISOString(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodePublicationSweepResume(token: string): PublicationSweepCursor {
  if (!token || token.length > 2_048 || !/^[A-Za-z0-9_-]+$/u.test(token)) {
    throw new Error('invalid publication sweep resume token')
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    throw new Error('invalid publication sweep resume token')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid publication sweep resume token')
  }
  const candidate = payload as Partial<ResumePayload>
  if (
    candidate.v !== RESUME_VERSION ||
    (candidate.mode !== 'dry_run' && candidate.mode !== 'apply') ||
    !UUID.test(candidate.id ?? '')
  ) {
    throw new Error('invalid publication sweep resume token')
  }
  const dueThrough = canonicalDate(candidate.dueThrough, 'due-through timestamp')
  const reconcileDueAt = canonicalDate(
    candidate.reconcileDueAt,
    'reconciliation timestamp',
  )
  if (reconcileDueAt > dueThrough) {
    throw new Error('invalid publication sweep resume ordering')
  }
  return {
    mode: candidate.mode,
    dueThrough,
    reconcileDueAt,
    id: candidate.id as string,
  }
}

export function extractPublicationSweepResume(
  argv: ReadonlyArray<string>,
): Readonly<{ argv: ReadonlyArray<string>; resumeToken: string | null }> {
  const stripped: string[] = []
  let resumeToken: string | null = null
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string
    if (token !== '--resume') {
      stripped.push(token)
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--') || resumeToken !== null) {
      throw new Error('--resume requires exactly one token')
    }
    resumeToken = value
    index++
  }
  return { argv: stripped, resumeToken }
}

function compareKeyset(
  left: Pick<AmbiguousPublicationReconciliationCandidate, 'replyId' | 'reconcileDueAt'>,
  right: Pick<AmbiguousPublicationReconciliationCandidate, 'replyId' | 'reconcileDueAt'>,
): number {
  const dueOrder = left.reconcileDueAt.getTime() - right.reconcileDueAt.getTime()
  if (dueOrder !== 0) return dueOrder
  const leftId = String(left.replyId).toLowerCase()
  const rightId = String(right.replyId).toLowerCase()
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function assertProgressingBatch(
  batch: ReadonlyArray<AmbiguousPublicationReconciliationCandidate>,
  dueThrough: Date,
  cursor: PublicationSweepCursor | null,
): void {
  for (let index = 0; index < batch.length; index++) {
    const row = batch[index] as AmbiguousPublicationReconciliationCandidate
    if (
      row.publicationState !== 'ambiguous' ||
      row.reconcileDueAt > dueThrough ||
      (index > 0 &&
        compareKeyset(
          batch[index - 1] as AmbiguousPublicationReconciliationCandidate,
          row,
        ) >= 0)
    ) {
      throw new Error('ambiguous publication sweep candidate contract violated')
    }
    if (
      cursor &&
      compareKeyset(
        {
          replyId: replyId(cursor.id),
          reconcileDueAt: cursor.reconcileDueAt,
        },
        row,
      ) >= 0
    ) {
      throw new Error('ambiguous publication sweep did not advance its keyset')
    }
  }
}

type PublicationSweepPlan = Readonly<{
  cursor: PublicationSweepCursor | null
  mode: 'dry_run' | 'apply'
  dueThrough: Date
}>

/**
 * Resolve the bounded page this invocation may sweep. A resume token freezes
 * both the due-through boundary and the mode, so a page cannot be resumed into
 * a different invocation shape.
 */
function resolveSweepPlan(
  deps: PublicationSweepDeps,
  input: PublicationSweepInput,
): PublicationSweepPlan {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error('publication sweep batch size must be a positive integer')
  }
  const cursor = input.resumeToken
    ? decodePublicationSweepResume(input.resumeToken)
    : null
  const mode = input.dryRun ? 'dry_run' : 'apply'
  if (cursor && cursor.mode !== mode) {
    throw new Error('publication sweep resume token mode does not match invocation')
  }
  const dueThrough = cursor?.dueThrough ?? deps.clock()
  if (Number.isNaN(dueThrough.getTime())) {
    throw new Error('publication sweep clock returned an invalid time')
  }
  return { cursor, mode, dueThrough }
}

type PublicationSweepRowOutcome = PublicationSweepReport['rows'][number]['outcome']

type PublicationSweepRowResult = Readonly<{
  outcome: PublicationSweepRowOutcome
  detail: string | null
}>

/**
 * Re-read provider truth for one candidate. A provider-read/infrastructure
 * exception is one failed row, not permission to abandon the page and starve
 * every later keyset row. No raw error is returned because operator output is
 * content-free.
 */
async function reconcileSweepCandidate(
  deps: PublicationSweepDeps,
  candidate: AmbiguousPublicationReconciliationCandidate,
): Promise<PublicationSweepRowResult> {
  try {
    const reconciled = await deps.reconcile({
      replyId: candidate.replyId,
      organizationId: candidate.organizationId,
    })
    if (reconciled.isErr()) return { outcome: 'failed', detail: reconciled.error.code }
    if (reconciled.value.outcome === 'confirmed_on_google') {
      return { outcome: 'confirmed_on_google', detail: null }
    }
    return { outcome: 'not_confirmed', detail: reconciled.value.outcome }
  } catch {
    return { outcome: 'failed', detail: 'unexpected_error' }
  }
}

/** Rows are evaluated strictly in keyset order; a dry run evaluates none. */
async function evaluateSweepBatch(
  deps: PublicationSweepDeps,
  batch: readonly AmbiguousPublicationReconciliationCandidate[],
  dryRun: boolean,
): Promise<readonly PublicationSweepRowResult[]> {
  if (dryRun)
    return batch.map(() => ({ outcome: 'not_evaluated' as const, detail: null }))
  const outcomes: PublicationSweepRowResult[] = []
  for (const candidate of batch) {
    outcomes.push(await reconcileSweepCandidate(deps, candidate))
  }
  return outcomes
}

function countOutcome(
  rowOutcomes: readonly PublicationSweepRowResult[],
  outcome: PublicationSweepRowOutcome,
): number {
  return rowOutcomes.filter((row) => row.outcome === outcome).length
}

/**
 * Reconcile one keyset page. This dependency surface deliberately exposes
 * only the provider-read reconciliation use case; there is no publication
 * command or provider-write port available to the operator sweep.
 */
export async function runAmbiguousPublicationSweepPage(
  deps: PublicationSweepDeps,
  input: PublicationSweepInput,
): Promise<PublicationSweepReport> {
  const { cursor, mode, dueThrough } = resolveSweepPlan(deps, input)
  const batch = await deps.findCandidates({
    dueThrough,
    after: cursor
      ? { reconcileDueAt: cursor.reconcileDueAt, replyId: replyId(cursor.id) }
      : null,
    limit: input.batchSize,
  })
  assertProgressingBatch(batch, dueThrough, cursor)

  const rowOutcomes = await evaluateSweepBatch(deps, batch, input.dryRun)
  const notConfirmed = countOutcome(rowOutcomes, 'not_confirmed')
  const failed = countOutcome(rowOutcomes, 'failed')

  const last = batch.at(-1)
  const nextResumeToken =
    batch.length === input.batchSize && last
      ? encodePublicationSweepResume({
          mode,
          dueThrough,
          reconcileDueAt: last.reconcileDueAt,
          id: last.replyId,
        })
      : null
  return {
    mode,
    coverage: nextResumeToken ? 'partial' : 'complete',
    coverageScope: 'frozen_due_through_keyset_segment',
    outcomeScope: 'current_page',
    dueThrough: dueThrough.toISOString(),
    startedAfter: cursor
      ? { reconcileDueAt: cursor.reconcileDueAt.toISOString(), id: cursor.id }
      : null,
    seen: batch.length,
    attempted: input.dryRun ? 0 : batch.length,
    notEvaluated: input.dryRun ? batch.length : 0,
    confirmedOnGoogle: countOutcome(rowOutcomes, 'confirmed_on_google'),
    notConfirmed,
    failed,
    unresolvedInPage: input.dryRun ? batch.length : notConfirmed + failed,
    rows: batch.map((candidate, index) => ({
      replyId: candidate.replyId,
      organizationId: candidate.organizationId,
      reconcileDueAt: candidate.reconcileDueAt.toISOString(),
      outcome: rowOutcomes[index]!.outcome,
      detail: rowOutcomes[index]!.detail,
    })),
    nextResumeToken,
  }
}

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  let resume: ReturnType<typeof extractPublicationSweepResume>
  try {
    resume = extractPublicationSweepResume(process.argv.slice(2))
    if (resume.resumeToken) decodePublicationSweepResume(resume.resumeToken)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'invalid --resume token')
    usage()
  }
  const argv = resume.argv
  const [singleReplyId] = positionalArgs(argv)
  const allAmbiguous = argv.includes('--all-ambiguous')
  if (!singleReplyId && !allAmbiguous) usage()
  if (singleReplyId && allAmbiguous) usage()
  if (resume.resumeToken && !allAmbiguous) usage()

  const result = await runOperatorCommand(
    {
      name: 'ops:reconcile-publication',
      // Single reply: org-scoped. --all-ambiguous: tenant-cross sweep bound.
      scope: singleReplyId ? 'org' : 'global',
      mutation: true,
      batchSize: { default: 100, max: 500 },
      extraFlags: ['all-ambiguous'],
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const container = getContainer()

      if (singleReplyId) {
        if (ctx.dryRun) {
          io.out(
            `would reconcile replyId=${singleReplyId} org=${ctx.organizationId} — re-run with --apply`,
          )
          return
        }
        const reconciled =
          await container.reviewMaintenanceRuntime.publicationReconciliation.reconcile({
            replyId: replyId(singleReplyId),
            organizationId: organizationId(ctx.organizationId as string),
          })
        if (reconciled.isErr()) {
          io.err(`reconcile failed: ${reconciled.error.code}`)
          return 1
        }
        io.out(JSON.stringify({ replyId: singleReplyId, ...reconciled.value }, null, 2))
        return
      }

      const report = await runAmbiguousPublicationSweepPage(
        {
          findCandidates:
            container.reviewMaintenanceRuntime.publicationReconciliation.findCandidates,
          reconcile:
            container.reviewMaintenanceRuntime.publicationReconciliation.reconcile,
          clock: () => new Date(),
        },
        {
          batchSize: ctx.batchSize as number,
          resumeToken: resume.resumeToken,
          dryRun: ctx.dryRun,
        },
      )
      io.out(JSON.stringify(report, null, 2))
      const segmentStart = report.startedAfter
        ? `${report.startedAfter.reconcileDueAt}/${report.startedAfter.id}`
        : 'beginning'
      if (report.nextResumeToken) {
        io.out(
          `coverage partial for frozen keyset segment startedAfter=${segmentStart} dueThrough=${report.dueThrough} — continue the same ${report.mode} sweep with --resume ${report.nextResumeToken}`,
        )
      } else if (ctx.dryRun) {
        io.out(
          `coverage complete for frozen keyset segment startedAfter=${segmentStart} dueThrough=${report.dueThrough} — current page reported ${report.notEvaluated} row(s); no provider truth was evaluated`,
        )
      } else {
        io.out(
          `coverage complete for frozen keyset segment startedAfter=${segmentStart} dueThrough=${report.dueThrough} — current page confirmed=${report.confirmedOnGoogle} notConfirmed=${report.notConfirmed} failed=${report.failed}; coverage does not assert that rows before this segment healed`,
        )
      }
      if (report.failed > 0) return 1
    },
    argv,
  )
  process.exit(result.exitCode)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error('ops:reconcile-publication failed', err)
    process.exit(1)
  })
}
