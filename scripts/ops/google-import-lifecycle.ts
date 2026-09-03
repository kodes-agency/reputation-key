import { getPool } from '../../src/shared/db/pool'
import { closeJobQueueConnections, createJobQueue } from '../../src/shared/jobs/queue'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import {
  createGoogleImportCompatibilityLifecycle,
  type GoogleImportCompatibilityMutation,
} from '../../src/shared/ops/google-import-compatibility-lifecycle'
import {
  createGoogleImportCompatibilityAdapter,
  type CompatibilityBullQueue,
} from '../../src/shared/ops/google-import-compatibility-adapter'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:google-import-lifecycle'
const USAGE =
  'pnpm ops:google-import-lifecycle <inspect|inspect-request|cancel-request|switch-connected-events|switch-oauth-state|mark-v1-events-drained|quiesce-legacy|drain-legacy-queues|close-legacy|archive-legacy> [importJobId] --operator <id> [--org <id> --reason <text> --apply --yes ops:google-import-lifecycle]'

const COMPATIBILITY_MUTATIONS = [
  'switch-connected-events',
  'switch-oauth-state',
  'mark-v1-events-drained',
  'quiesce-legacy',
  'drain-legacy-queues',
  'close-legacy',
  'archive-legacy',
] as const

type CompatibilityMutationAction = (typeof COMPATIBILITY_MUTATIONS)[number]
type Action =
  'inspect' | 'inspect-request' | 'cancel-request' | CompatibilityMutationAction

function isCompatibilityMutation(value: string): value is CompatibilityMutationAction {
  return (COMPATIBILITY_MUTATIONS as readonly string[]).includes(value)
}

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

function parseAction(argv: readonly string[]): Readonly<{
  action: Action
  importJobId?: string
}> {
  const [rawAction, importJobId, ...extra] = positionalArgs(argv)
  if (
    !rawAction ||
    extra.length > 0 ||
    (rawAction !== 'inspect' &&
      rawAction !== 'inspect-request' &&
      rawAction !== 'cancel-request' &&
      !isCompatibilityMutation(rawAction))
  ) {
    usage()
  }
  const action = rawAction as Action
  const requestAction = action === 'inspect-request' || action === 'cancel-request'
  if (requestAction !== Boolean(importJobId)) usage()
  return { action, importJobId }
}

async function withCompatibilityLifecycle<T>(
  work: (
    lifecycle: ReturnType<typeof createGoogleImportCompatibilityLifecycle>,
  ) => Promise<T>,
): Promise<T> {
  const defaultQueue = createJobQueue('default')
  const domainEventsQueue = createJobQueue('domain-events')
  if (!defaultQueue || !domainEventsQueue) {
    await closeJobQueueConnections()
    throw new Error('Google import compatibility inspection requires QUEUE_REDIS_URL')
  }
  try {
    const adapter = createGoogleImportCompatibilityAdapter({
      pool: getPool(),
      defaultQueue: defaultQueue as unknown as CompatibilityBullQueue,
      domainEventsQueue: domainEventsQueue as unknown as CompatibilityBullQueue,
    })
    return await work(createGoogleImportCompatibilityLifecycle(adapter))
  } finally {
    await Promise.all([defaultQueue.close(), domainEventsQueue.close()])
    await closeJobQueueConnections()
  }
}

async function applyCompatibilityAction(
  action: CompatibilityMutationAction,
  mutation: GoogleImportCompatibilityMutation,
) {
  return withCompatibilityLifecycle(async (lifecycle) => {
    switch (action) {
      case 'switch-connected-events':
        return lifecycle.switchConnectedEvents(mutation)
      case 'switch-oauth-state':
        return lifecycle.switchOauthState(mutation)
      case 'mark-v1-events-drained':
        return lifecycle.markV1EventsDrained(mutation)
      case 'quiesce-legacy':
        return lifecycle.quiesce(mutation)
      case 'drain-legacy-queues':
        await lifecycle.drainLegacyQueues(mutation)
        return lifecycle.inspect()
      case 'close-legacy':
        return lifecycle.close(mutation)
      case 'archive-legacy':
        return lifecycle.archive(mutation)
    }
  })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const { action, importJobId } = parseAction(argv)
  const mutation = action === 'cancel-request' || isCompatibilityMutation(action)

  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope:
        action === 'inspect-request' || action === 'cancel-request' ? 'org' : 'global',
      mutation,
      destructive: mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      if (isCompatibilityMutation(action)) {
        const before = await withCompatibilityLifecycle((lifecycle) =>
          lifecycle.inspect(),
        )
        if (ctx.dryRun) {
          io.out(JSON.stringify({ action: `would_${action}`, before }, null, 2))
          io.out(`re-run with --apply --yes ${COMMAND_NAME}`)
          return
        }
        const after = await applyCompatibilityAction(action, {
          operatorId: ctx.operatorId,
          reason: ctx.reason as string,
          now: new Date(),
        })
        io.out(JSON.stringify({ action, before, after }, null, 2))
        return
      }

      const { container } = ctx
      if (action === 'inspect') {
        const inspect = container.integrationMaintenanceRuntime.imports.inspectBacklog
        if (!inspect) throw new Error('Google import v2 lifecycle unavailable')
        const [v2, compatibility] = await Promise.all([
          inspect(),
          withCompatibilityLifecycle((lifecycle) => lifecycle.inspect()),
        ])
        io.out(JSON.stringify({ v2, compatibility }, null, 2))
        return
      }

      const organizationId = ctx.organizationId as string
      const inspectRequest =
        container.integrationMaintenanceRuntime.imports.inspectRequest
      if (!inspectRequest) throw new Error('Google import v2 lifecycle unavailable')
      const before = await inspectRequest(organizationId, importJobId as string)
      if (action === 'inspect-request') {
        io.out(JSON.stringify({ organizationId, request: before }, null, 2))
        return
      }

      if (ctx.dryRun) {
        io.out(
          JSON.stringify(
            {
              organizationId,
              importJobId,
              request: before,
              action: 'would_cancel',
            },
            null,
            2,
          ),
        )
        io.out(`re-run with --apply --yes ${COMMAND_NAME}`)
        return
      }

      const cancel = container.integrationMaintenanceRuntime.imports.cancelRequest
      if (!cancel) throw new Error('Google import v2 lifecycle unavailable')
      const cancellation = await cancel(organizationId, importJobId as string)
      const after = await inspectRequest(organizationId, importJobId as string)
      io.out(
        JSON.stringify(
          {
            organizationId,
            importJobId,
            cancellation,
            request: after,
          },
          null,
          2,
        ),
      )
    },
    argv,
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error(`${COMMAND_NAME} failed`, err)
  process.exit(1)
})
