import type { WorkItems } from '#/shared/jobs/work-items.server'
import type {
  OperatorArgs,
  OperatorCommandSpec,
  OperatorContext,
  OperatorIO,
} from './operator-command'

const ACTIONS = ['list', 'inspect', 'retry', 'cancel', 'discard'] as const
type Action = (typeof ACTIONS)[number]

export function workCommandSpec(action: string | undefined): OperatorCommandSpec {
  return {
    name: 'ops:work',
    scope: 'org',
    mutation: action !== 'list' && action !== 'inspect',
    usage:
      'pnpm ops work <list|inspect|retry|cancel|discard> [id] --org <id> --operator <id> [--reason <text> --apply]',
  }
}

export async function runWorkCommand(
  input: Readonly<{
    store: Pick<WorkItems, 'list' | 'inspect' | 'operate'>
    ctx: OperatorContext
    args: OperatorArgs
    io: OperatorIO
  }>,
) {
  const { store, ctx, args, io } = input
  const [rawAction, id, ...extra] = args.positionals
  const action = ACTIONS.find((candidate): candidate is Action => candidate === rawAction)
  if (
    !action ||
    !ctx.organizationId ||
    extra.length ||
    (action === 'list'
      ? id !== undefined
      : !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  ) {
    io.err('Expected list, or inspect/retry/cancel/discard with one work UUID and --org.')
    return 1
  }
  if (action === 'list') {
    for (const row of await store.list(ctx.organizationId)) io.out(JSON.stringify(row))
    return 0
  }
  const row = await store.inspect(ctx.organizationId, id!)
  if (!row) {
    io.err('Work item not found.')
    return 1
  }
  if (action === 'inspect' || ctx.dryRun) {
    io.out(JSON.stringify({ action, dryRun: ctx.dryRun, work: row }))
    return 0
  }
  const changed = await store.operate(
    ctx.organizationId,
    row.id,
    action,
    ctx.operatorId,
    ctx.reason ?? '',
  )
  if (!changed) {
    io.err('Work state refuses this action; uncertain effects require owner read-back.')
    return 1
  }
  io.out(JSON.stringify({ action, work: changed, correlationId: ctx.correlationId }))
  return 0
}
