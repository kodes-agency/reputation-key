// Operator CLI (BQC-7.5): reconcile ambiguous Google reply publication via
// the reconcileReplyPublication use case (BQC-3.8). The use case re-reads
// provider state and heals provider-confirmed rows to published — it NEVER
// publishes.
//
// Usage:
//   pnpm ops:reconcile-publication <replyId> --operator <id> --org <id> [--reason <text> --apply]
//   pnpm ops:reconcile-publication --all-ambiguous --operator <id> [--batch-size <n>] [--reason <text> --apply]
//
// Bounded: a single reply, or ONE batch of due ambiguous rows (default 100,
// max 500 — the sweep's own batch bound). Dry-run lists what would be
// reconciled; --apply runs the reconcile. Requires DATABASE_URL.
// Identifier-only output (reply/org ids + outcomes) — content-free.

import { getContainer } from '../../src/composition'
import { organizationId, replyId } from '../../src/shared/domain/ids'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-publication [<replyId> --org <id> | --all-ambiguous] --operator <id> [--batch-size <n>] [--reason <text> --apply]'

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const [singleReplyId] = positionalArgs(argv)
  const allAmbiguous = argv.includes('--all-ambiguous')
  if (!singleReplyId && !allAmbiguous) usage()
  if (singleReplyId && allAmbiguous) usage()

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

      // --all-ambiguous: one bounded batch of due rows (the sweep's own bound).
      const batch = await container.replyRepo.findAmbiguousPublicationBatch(
        new Date(),
        null,
        ctx.batchSize as number,
      )
      io.out(`due ambiguous publications: ${batch.length} (batch ≤ ${ctx.batchSize})`)
      if (ctx.dryRun) {
        for (const reply of batch) {
          io.out(
            `  reply=${reply.id} org=${reply.organizationId} due=${reply.reconcileDueAt?.toISOString()}`,
          )
        }
        io.out('report only — re-run with --apply to reconcile this batch')
        return
      }
      const counts = { healed: 0, stillFailed: 0, failed: 0 }
      for (const reply of batch) {
        const reconciled = await container.useCases.reconcileReplyPublication({
          replyId: reply.id,
          organizationId: reply.organizationId,
        })
        if (reconciled.isErr()) counts.failed++
        else if (reconciled.value.outcome === 'published') counts.healed++
        else counts.stillFailed++
      }
      io.out(JSON.stringify({ seen: batch.length, ...counts }, null, 2))
      if (counts.failed > 0) return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:reconcile-publication failed', err)
  process.exit(1)
})
