import {
  copyNotificationCategoryDefaults,
  countNotificationCategoryDefaultsToCopy,
} from '../../src/contexts/feed/application/public-api'
import { runOperatorCommand } from './operator-command'

const usage =
  'pnpm ops copy-notification-defaults --operator <id> [--reason <text> --apply] [--batch-size <1..5000>]'

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(`usage: ${usage}`)
    return
  }
  const result = await runOperatorCommand(
    {
      name: 'ops:copy-notification-defaults',
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
      const before = await countNotificationCategoryDefaultsToCopy(db)
      if (ctx.dryRun) {
        io.out(
          `ops:copy-notification-defaults: dry-run — ${before.missing} missing, ${before.differing} differing`,
        )
        return
      }
      const copied = await copyNotificationCategoryDefaults(db, {
        ...(ctx.batchSize ? { batchSize: ctx.batchSize } : {}),
      })
      const after = await countNotificationCategoryDefaultsToCopy(db)
      io.out(
        `ops:copy-notification-defaults: applied — ${copied.inserted} inserted, ${copied.updated} updated; ${after.missing} missing, ${after.differing} differing remain`,
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
