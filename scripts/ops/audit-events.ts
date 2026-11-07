import { readAuditEvents } from '../../src/contexts/feed/application/public-api'
import { runOperatorCommand } from './operator-command'

const usage =
  'pnpm ops audit-events --operator <id> --org <id> [--property <id>] [--batch-size <1..100>]'

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(`usage: ${usage}`)
    return
  }
  const result = await runOperatorCommand(
    {
      name: 'ops:audit-events',
      scope: 'org',
      batchSize: { default: 100, max: 100 },
      usage,
    },
    async (ctx, args, io) => {
      if (
        !ctx.organizationId ||
        args.organizations.length !== 1 ||
        args.apply ||
        args.positionals.length > 0
      ) {
        io.err('Audit events requires one Organization and accepts reads only.')
        return 1
      }
      const items = await readAuditEvents(ctx.container.db, {
        organizationId: ctx.organizationId,
        ...(ctx.propertyId ? { propertyId: ctx.propertyId } : {}),
        observedAt: ctx.container.clock(),
        limit: ctx.batchSize,
      })
      io.out(JSON.stringify({ items }, null, 2))
    },
    argv,
  )
  process.exitCode = result.exitCode
}

main().catch(() => {
  console.error('Audit events read failed. Check arguments and database access.')
  process.exitCode = 1
})
