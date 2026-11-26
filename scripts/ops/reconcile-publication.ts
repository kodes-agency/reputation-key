// Operator CLI (BQC-7.5): list ambiguous Google reply publication waiting for
// reconciliation. REPORT ONLY: `--apply` is refused by the operator harness.
//
// Reconciling re-reads the reply on Google, and operator commands run without
// the Google provider runtime, so this command cannot do it
// (src/shared/ops/google-provider-commands.ts). What does:
//
//   - The worker's `reconcile-ambiguous-publications` job, every five minutes:
//     it re-reads Google for every due reply (reconcileReplyPublication,
//     BQC-3.8) and heals provider-confirmed rows to published. It never
//     publishes.
//   - A manager, on demand: Check Google again on the reply in the Inbox.
//
// Both reads are review-sync provider calls under property.connect_gbp, and
// Check Google again is a reply command first (property.publish_reply). A
// stop of either, or a suspended Organization, refuses that read and the
// reply stays ambiguous (runbook §6).
//
// Usage:
//   pnpm ops reconcile-publication <replyId> --operator <id> --org <id>
//   pnpm ops reconcile-publication --all-ambiguous --operator <id> [--batch-size <n>]
//   pnpm ops reconcile-publication --all-ambiguous --resume <token> --operator <id>
//
// Bounded: a single reply, or ONE keyset page of due ambiguous rows per
// invocation (default 100, max 500). A full page reports partial and returns
// an opaque --resume token. Resuming preserves the original due-through
// boundary and starts strictly after the prior page. Every row is listed as
// `not_evaluated`: no provider truth is read.
// Requires DATABASE_URL.
// Identifier-only output (reply/org ids + outcomes) — content-free.

import { pathToFileURL } from 'node:url'
import { replyId } from '../../src/shared/domain/ids'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import type {
  AmbiguousPublicationReconciliationCandidate,
  FindAmbiguousPublicationReconciliationCandidates,
} from '../../src/contexts/reputation/public-api'
import { exitIfHelp } from './command-help'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops reconcile-publication [<replyId> --org <id> | --all-ambiguous [--resume <token>]] --operator <id> [--batch-size <n>]'

const RESUME_VERSION = 1 as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type PublicationSweepCursor = Readonly<{
  dueThrough: Date
  reconcileDueAt: Date
  id: string
}>

type PublicationSweepDeps = Readonly<{
  findCandidates: FindAmbiguousPublicationReconciliationCandidates
  clock: () => Date
}>

type PublicationSweepInput = Readonly<{
  batchSize: number
  resumeToken: string | null
}>

export type PublicationSweepReport = Readonly<{
  mode: 'dry_run'
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
      outcome: 'not_evaluated'
      detail: null
    }>
  >
  nextResumeToken: string | null
}>

type ResumePayload = Readonly<{
  v: typeof RESUME_VERSION
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
  if (candidate.v !== RESUME_VERSION || !UUID.test(candidate.id ?? '')) {
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
  dueThrough: Date
}>

/** Resolve the bounded page this invocation may sweep. A resume token freezes the due-through boundary. */
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
  const dueThrough = cursor?.dueThrough ?? deps.clock()
  if (Number.isNaN(dueThrough.getTime())) {
    throw new Error('publication sweep clock returned an invalid time')
  }
  return { cursor, dueThrough }
}

/**
 * List one keyset page. This dependency surface deliberately exposes only the
 * candidate read; no provider read or publication command is available to the
 * operator sweep, so every row is reported as not evaluated.
 */
export async function runAmbiguousPublicationSweepPage(
  deps: PublicationSweepDeps,
  input: PublicationSweepInput,
): Promise<PublicationSweepReport> {
  const { cursor, dueThrough } = resolveSweepPlan(deps, input)
  const batch = await deps.findCandidates({
    dueThrough,
    after: cursor
      ? { reconcileDueAt: cursor.reconcileDueAt, replyId: replyId(cursor.id) }
      : null,
    limit: input.batchSize,
  })
  assertProgressingBatch(batch, dueThrough, cursor)

  const last = batch.at(-1)
  const nextResumeToken =
    batch.length === input.batchSize && last
      ? encodePublicationSweepResume({
          dueThrough,
          reconcileDueAt: last.reconcileDueAt,
          id: last.replyId,
        })
      : null
  return {
    mode: 'dry_run',
    coverage: nextResumeToken ? 'partial' : 'complete',
    coverageScope: 'frozen_due_through_keyset_segment',
    outcomeScope: 'current_page',
    dueThrough: dueThrough.toISOString(),
    startedAfter: cursor
      ? { reconcileDueAt: cursor.reconcileDueAt.toISOString(), id: cursor.id }
      : null,
    seen: batch.length,
    attempted: 0,
    notEvaluated: batch.length,
    confirmedOnGoogle: 0,
    notConfirmed: 0,
    failed: 0,
    unresolvedInPage: batch.length,
    rows: batch.map((candidate) => ({
      replyId: candidate.replyId,
      organizationId: candidate.organizationId,
      reconcileDueAt: candidate.reconcileDueAt.toISOString(),
      outcome: 'not_evaluated',
      detail: null,
    })),
    nextResumeToken,
  }
}

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  exitIfHelp(process.argv.slice(2), USAGE)
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
      if (singleReplyId) {
        io.out(
          `a reconciliation of replyId=${singleReplyId} org=${ctx.organizationId} would re-read the reply on Google`,
        )
        return
      }

      const report = await runAmbiguousPublicationSweepPage(
        {
          findCandidates:
            ctx.container.reviewMaintenanceRuntime.publicationReconciliation
              .findCandidates,
          clock: () => new Date(),
        },
        { batchSize: ctx.batchSize as number, resumeToken: resume.resumeToken },
      )
      io.out(JSON.stringify(report, null, 2))
      const segmentStart = report.startedAfter
        ? `${report.startedAfter.reconcileDueAt}/${report.startedAfter.id}`
        : 'beginning'
      if (report.nextResumeToken) {
        io.out(
          `coverage partial for frozen keyset segment startedAfter=${segmentStart} dueThrough=${report.dueThrough} — continue the same ${report.mode} sweep with --resume ${report.nextResumeToken}`,
        )
      } else {
        io.out(
          `coverage complete for frozen keyset segment startedAfter=${segmentStart} dueThrough=${report.dueThrough} — current page reported ${report.notEvaluated} row(s); no provider truth was evaluated`,
        )
      }
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
