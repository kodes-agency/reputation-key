// Read-only LIF-01 operator diagnostic. It reports the exact Identity-owned
// lifecycle authority plus production composition readiness; it cannot waive,
// cancel, begin purge, reactivate, generate an export, or delete an object.

import { getContainer } from '../../src/composition'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:report-organization-lifecycle --operator <id> --org <organization-id>'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:report-organization-lifecycle',
      scope: 'org',
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const container = getContainer()
      const organizationId = ctx.organizationId as string
      const status =
        await container.identityLifecycleRuntime.operator.readStatus(organizationId)
      io.out(
        JSON.stringify(
          {
            organizationId: status.organizationId,
            state: status.state,
            revision: status.revision,
            closureLineageId: status.closureLineageId,
            recoverableUntil: status.recoverableUntil?.toISOString() ?? null,
            irreversibleAt: status.irreversibleAt?.toISOString() ?? null,
            reactivationRequired: status.reactivationRequired,
            composition: {
              lifecycle: container.identityLifecycleRuntime.maintenance.readiness,
              organizationExport:
                container.identityLifecycleRuntime.organizationExport.readiness,
            },
          },
          null,
          2,
        ),
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(
    'Organization lifecycle report failed:',
    error instanceof Error ? error.name : 'UnknownError',
  )
  process.exit(1)
})
