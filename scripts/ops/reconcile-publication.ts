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
import type { ReplyRepository } from '../../src/contexts/review/application/ports/reply.repository'
import type { ReconcileReplyPublication } from '../../src/contexts/review/application/use-cases/reconcile-reply-publication'
import type { Reply } from '../../src/contexts/review/domain/types'
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
  findBatch: ReplyRepository['findAmbiguousPublicationBatch']
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

function compareKeyset(left: Reply, right: Reply): number {
  const leftDue = left.reconcileDueAt
  const rightDue = right.reconcileDueAt
  if (!leftDue || !rightDue) {
    throw new Error('ambiguous publication sweep received an undated row')
  }
  const dueOrder = leftDue.getTime() - rightDue.getTime()
  if (dueOrder !== 0) return dueOrder
  const leftId = String(left.id).toLowerCase()
  const rightId = String(right.id).toLowerCase()
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function assertProgressingBatch(
  batch: ReadonlyArray<Reply>,
  dueThrough: Date,
  cursor: PublicationSweepCursor | null,
): void {
  for (let index = 0; index < batch.length; index++) {
    const row = batch[index] as Reply
    if (
      row.publicationState !== 'ambiguous' ||
      !row.reconcileDueAt ||
      row.reconcileDueAt > dueThrough ||
      (index > 0 && compareKeyset(batch[index - 1] as Reply, row) >= 0)
    ) {
      throw new Error('ambiguous publication sweep repository contract violated')
    }
    if (
      cursor &&
      compareKeyset(
        {
          ...row,
          id: replyId(cursor.id),
          reconcileDueAt: cursor.reconcileDueAt,
        },
        row,
      ) >= 0
    ) {
      throw new Error('ambiguous publication sweep did not advance its keyset')
    }
  }
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
  const batch = await deps.findBatch(
    dueThrough,
    cursor ? { reconcileDueAt: cursor.reconcileDueAt, id: cursor.id } : null,
    input.batchSize,
  )
  assertProgressingBatch(batch, dueThrough, cursor)

  let confirmedOnGoogle = 0
  let notConfirmed = 0
  let failed = 0
  const rowOutcomes: Array<
    Readonly<{
      outcome: 'not_evaluated' | 'confirmed_on_google' | 'not_confirmed' | 'failed'
      detail: string | null
    }>
  > = []
  if (!input.dryRun) {
    for (const reply of batch) {
      try {
        const reconciled = await deps.reconcile({
          replyId: reply.id,
          organizationId: reply.organizationId,
        })
        if (reconciled.isErr()) {
          failed++
          rowOutcomes.push({ outcome: 'failed', detail: reconciled.error.code })
        } else if (reconciled.value.outcome === 'confirmed_on_google') {
          confirmedOnGoogle++
          rowOutcomes.push({ outcome: 'confirmed_on_google', detail: null })
        } else {
          notConfirmed++
          rowOutcomes.push({
            outcome: 'not_confirmed',
            detail: reconciled.value.outcome,
          })
        }
      } catch {
        // A provider-read/infrastructure exception is one failed row, not
        // permission to abandon the page and starve every later keyset row.
        // No raw error is returned because operator output is content-free.
        failed++
        rowOutcomes.push({ outcome: 'failed', detail: 'unexpected_error' })
      }
    }
  } else {
    rowOutcomes.push(
      ...batch.map(() => ({ outcome: 'not_evaluated' as const, detail: null })),
    )
  }

  const last = batch.at(-1)
  const nextResumeToken =
    batch.length === input.batchSize && last?.reconcileDueAt
      ? encodePublicationSweepResume({
          mode,
          dueThrough,
          reconcileDueAt: last.reconcileDueAt,
          id: last.id,
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
    confirmedOnGoogle,
    notConfirmed,
    failed,
    unresolvedInPage: input.dryRun ? batch.length : notConfirmed + failed,
    rows: batch.map((reply, index) => ({
      replyId: reply.id,
      organizationId: reply.organizationId,
      reconcileDueAt: reply.reconcileDueAt!.toISOString(),
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
        const reconciled = await container.useCases.reconcileReplyPublication({
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
          findBatch: container.replyRepo.findAmbiguousPublicationBatch,
          reconcile: container.useCases.reconcileReplyPublication,
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
