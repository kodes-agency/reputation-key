import { createWorkItems } from '../../src/shared/jobs/work-items.server'
import { runWorkCommand, workCommandSpec } from '../../src/shared/ops/work-command'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

async function main() {
  const spec = workCommandSpec(positionalArgs(process.argv.slice(2))[0])
  const result = await runOperatorCommand(spec, (ctx, args, io) =>
    runWorkCommand({
      store: createWorkItems(ctx.container.db, ctx.container.clock),
      ctx,
      args,
      io,
    }),
  )
  process.exit(result.exitCode)
}

main().catch(() => {
  console.error('ops:work failed')
  process.exit(1)
})
