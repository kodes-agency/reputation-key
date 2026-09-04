// Operator CLI (BQC-7.5): repair/rebuild the inbox projection from canonical
// review/reply data via Inbox's bounded maintenance capability (own
// clamps: batchSize ≤ 1000).
//
// Usage:
//   pnpm ops:rebuild-projection --operator <id> --org <id> [--property <id>]
//     — dry-run report (counts only)
//   pnpm ops:rebuild-projection --operator <id> --org <id> [--property <id>] \
//     --reason <text> --apply [--batch-size <n>]
//
// Requires DATABASE_URL. The use case is idempotent (repairs converge); the
// report is content-free (scanned/created/closed/milestones counts).
//
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:rebuild-projection --operator <id> --org <id> [--property <id>] [--batch-size <n>] [--reason <text> --apply]'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:rebuild-projection',
      scope: 'org', // --org required; --property narrows to one property
      mutation: true,
      capability: 'inbox.use',
      batchSize: { default: 200, max: 1000 },
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const { container } = ctx
      const report = await container.inboxMaintenanceRuntime.rebuildInboxProjection({
        organizationId: organizationId(ctx.organizationId as string),
        propertyId: ctx.propertyId ? propertyId(ctx.propertyId) : undefined,
        dryRun: ctx.dryRun,
        batchSize: ctx.batchSize,
      })
      io.out(JSON.stringify(report, null, 2))
      if (ctx.dryRun) {
        io.out('report only — re-run with --apply to repair the projection')
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:rebuild-projection failed', err)
  process.exit(1)
})
