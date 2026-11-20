import {
  copyAuditLogsToAuditEvents,
  countAuditLogsToCopyAsEvents,
} from '../../src/contexts/feed/application/public-api'
import { runOperatorCommand } from './operator-command'

const usage =
  'pnpm ops audit-logs-copy --operator <id> [--reason <text> --apply] [--batch-size <1..5000>]'

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(`usage: ${usage}`)
    return
  }
  const result = await runOperatorCommand(
    {
      name: 'ops:audit-logs-copy',
      scope: 'global',
      mutation: true,
      batchSize: { default: 500, max: 5000 },
      usage,
    },
    async (ctx, args, io) => {
      if (args.positionals.length > 0) {
        io.err(`Copy takes no positional arguments; usage: ${usage}`)
        return 1
      }
      const { db } = ctx.container
      const now = ctx.container.clock()
      const before = await countAuditLogsToCopyAsEvents(db, now)
      if (ctx.dryRun) {
        io.out(
          `ops:audit-logs-copy: dry-run — ${before.toCopy} to copy, ${before.unmappable} unmappable`,
        )
        return
      }
      if (before.unmappable > 0) {
        io.err(
          `ops:audit-logs-copy: refused — ${before.unmappable} unmappable rows; nothing written`,
        )
        return 1
      }
      const copied = await copyAuditLogsToAuditEvents(db, {
        now,
        ...(ctx.batchSize ? { batchSize: ctx.batchSize } : {}),
      })
      const after = await countAuditLogsToCopyAsEvents(db, now)
      io.out(
        `ops:audit-logs-copy: applied — ${copied.copied} copied; ${after.toCopy} remain`,
      )
    },
    argv,
  )
  process.exitCode = result.exitCode
}

main().catch(() => {
  console.error('Copy failed. Check arguments and database access.')
  process.exitCode = 1
})
