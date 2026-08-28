// Report-first repair for one anonymous Portal lifetime metric projection.
// The report computes canonical totals under the same per-Portal lock as apply
// and writes nothing. Apply rebuilds from the sealed anonymous baseline plus
// retained effective Metric facts; it cannot reset the retention checkpoint.
//
// Usage:
//   pnpm ops:rebuild-metric-projection <portalId> --operator <id>
//     --org <id> --property <id>
//   pnpm ops:rebuild-metric-projection <portalId> --operator <id>
//     --org <id> --property <id> --reason <text> --apply

import { getContainer } from '../../src/composition'
import { organizationId, portalId, propertyId } from '../../src/shared/domain/ids'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:rebuild-metric-projection'
const USAGE =
  'pnpm ops:rebuild-metric-projection <portalId> --operator <id> --org <id> --property <id> [--reason <text> --apply]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'property',
      mutation: true,
      capability: 'metric.internal',
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const [rawPortalId, ...extra] = args.positionals
      if (!rawPortalId || extra.length > 0 || !UUID.test(rawPortalId)) {
        throw new Error(`exactly one canonical Portal UUID is required; usage: ${USAGE}`)
      }
      if (!ctx.organizationId || !ctx.propertyId) {
        throw new Error('Organization and Property scope are required')
      }

      const report = await getContainer().metricMaintenanceRuntime.repairPortalLifetime({
        scope: {
          organizationId: organizationId(ctx.organizationId),
          propertyId: propertyId(ctx.propertyId),
          portalId: portalId(rawPortalId),
        },
        mode: ctx.dryRun ? 'report' : 'apply',
      })
      io.out(JSON.stringify(report, null, 2))
      if (ctx.dryRun) {
        io.out('report only — re-run with --reason <text> --apply to repair')
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error(`${COMMAND_NAME} failed`, err)
  process.exit(1)
})
