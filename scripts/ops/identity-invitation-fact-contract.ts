import { getPool } from '../../src/shared/db/pool'
import { closeJobQueueConnections, createJobQueue } from '../../src/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '../../src/shared/jobs/failure-quarantine'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import {
  createInvitationFactQueueAdapter,
  inspectIdentityInvitationFactContract,
  rollbackIdentityInvitationFactToV1,
  scrubIdentityInvitationFactContract,
  switchIdentityInvitationFactToV2,
  verifyIdentityInvitationFactContract,
  type InvitationFactContractDeps,
} from '../../src/shared/ops/identity-invitation-fact-contract'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:identity-invitation-facts'
const ACTIONS = [
  'inspect',
  'switch-v2',
  'scrub',
  'verify',
  'complete',
  'rollback-v1',
] as const
type Action = (typeof ACTIONS)[number]

const USAGE =
  `pnpm ${COMMAND_NAME} <${ACTIONS.join('|')}> --operator <id> ` +
  `[--batch-size <n> --reason <text> --apply --yes ${COMMAND_NAME}]`

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

function parseAction(argv: readonly string[]): Action {
  const [raw, ...extra] = positionalArgs(argv)
  if (!raw || extra.length > 0 || !(ACTIONS as readonly string[]).includes(raw)) {
    usage()
  }
  return raw as Action
}

async function withDeps<T>(
  work: (deps: InvitationFactContractDeps) => Promise<T>,
): Promise<T> {
  const defaultQueue = createJobQueue('default')
  const domainEventsQueue = createJobQueue('domain-events')
  const quarantineQueue = createJobQueue(QUARANTINE_QUEUE_NAME)
  if (!defaultQueue || !domainEventsQueue || !quarantineQueue) {
    await closeJobQueueConnections()
    throw new Error('identity invitation fact inspection requires QUEUE_REDIS_URL')
  }
  try {
    return await work({
      pool: getPool(),
      defaultQueue: createInvitationFactQueueAdapter(defaultQueue),
      domainEventsQueue: createInvitationFactQueueAdapter(domainEventsQueue),
      quarantineQueue: createInvitationFactQueueAdapter(quarantineQueue),
    })
  } finally {
    await Promise.all([
      defaultQueue.close(),
      domainEventsQueue.close(),
      quarantineQueue.close(),
    ])
    await closeJobQueueConnections()
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const action = parseAction(argv)
  const mutation = action !== 'inspect' && action !== 'verify'
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation,
      destructive: mutation,
      batchSize: { default: 100, max: 1000 },
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const before = await withDeps(inspectIdentityInvitationFactContract)
      if (action === 'inspect' || action === 'verify') {
        io.out(
          JSON.stringify(
            { action, correlationId: ctx.correlationId, inspection: before },
            null,
            2,
          ),
        )
        return before.privacyDirty > 0 && action === 'verify' ? 1 : undefined
      }
      if (ctx.dryRun) {
        const preview =
          action === 'scrub'
            ? await withDeps((deps) =>
                scrubIdentityInvitationFactContract(deps, {
                  batchSize: ctx.batchSize ?? 100,
                  apply: false,
                }),
              )
            : undefined
        io.out(
          JSON.stringify(
            {
              action: `would_${action}`,
              correlationId: ctx.correlationId,
              before,
              preview,
            },
            null,
            2,
          ),
        )
        io.out(`re-run with --apply --yes ${COMMAND_NAME}`)
        return
      }

      const mutationInput = {
        operatorId: ctx.operatorId,
        reason: ctx.reason as string,
      }
      const outcome = await withDeps(async (deps) => {
        switch (action) {
          case 'switch-v2':
            return switchIdentityInvitationFactToV2(deps, mutationInput)
          case 'rollback-v1':
            return rollbackIdentityInvitationFactToV1(deps, mutationInput)
          case 'complete':
            return verifyIdentityInvitationFactContract(deps, mutationInput)
          case 'scrub':
            return scrubIdentityInvitationFactContract(deps, {
              batchSize: ctx.batchSize ?? 100,
              apply: true,
            })
          default:
            throw new Error(`unsupported mutation action: ${action}`)
        }
      })
      const after = await withDeps(inspectIdentityInvitationFactContract)
      io.out(
        JSON.stringify(
          { action, correlationId: ctx.correlationId, before, outcome, after },
          null,
          2,
        ),
      )
      if (action === 'scrub' && 'errorCount' in outcome && outcome.errorCount > 0) {
        return 1
      }
    },
    argv,
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
