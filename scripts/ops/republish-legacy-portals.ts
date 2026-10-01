// Operator CLI (round 4, slice 46): republish every live v1/v2 Portal of an
// organisation as the current design (snapshot v3, the Immersive Hub), so every
// guest sees it and the legacy renderer can later be removed.
//
// Each Portal goes through the ordinary publish-while-live use case: the same
// readiness gates, the same content, a new version, the previous activation
// closed as `replaced`, the same facts. The actor recorded is `ops:<operator>`.
//
// Usage:
//   pnpm ops republish-legacy-portals --operator <id> --org <id> [--property <id>] [--batch-size <n>]
//     — dry run (the default): what would be republished, and which Portals
//       would be skipped as not ready, and why. Writes nothing.
//   pnpm ops republish-legacy-portals --operator <id> --org <id> [--property <id>] \
//     --reason <text> --apply
//
// Idempotent: a republished Portal is on v3 and is not selected again; a Portal
// that is not ready is skipped with the gate's reason, every run, until it is
// fixed. Draft-only, disabled, archived and deleted Portals are never selected.
// Output is identifiers, versions and Portal error codes only. Requires
// DATABASE_URL and QUEUE_REDIS_URL, like every ops command.

import { pathToFileURL } from 'node:url'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import type { OperatorCommandSpec } from '../../src/shared/ops/operator-command'
import type {
  RepublishLegacyPortalRow,
  RepublishLegacyPortals,
  RepublishLegacyPortalsReport,
} from '../../src/contexts/portal/application/use-cases/republish-legacy-portals'
import type { Container } from '../../src/composition'
import { runOperatorCommand, type OpsAction } from './operator-command'

const COMMAND_NAME = 'ops:republish-legacy-portals'
const USAGE =
  'pnpm ops republish-legacy-portals --operator <id> --org <id> [--property <id>] [--batch-size <n>] [--reason <text> --apply]'

export const REPUBLISH_LEGACY_PORTALS_SPEC = {
  name: COMMAND_NAME,
  scope: 'org', // --org required; --property narrows to one Property
  mutation: true,
  capability: 'portal.write',
  batchSize: { default: 50, max: 200 },
  usage: USAGE,
} satisfies OperatorCommandSpec

const describeRow = (row: RepublishLegacyPortalRow): string => {
  const head = `portal=${row.portalId} property=${row.propertyId} v${row.fromVersion} (schema ${row.fromSchemaVersion})`
  switch (row.outcome) {
    case 'republished':
      return `${head} republished -> v${row.toVersion}`
    case 'would_republish':
      return `${head} would republish -> v${row.toVersion}`
    case 'unchanged':
      return `${head} unchanged`
    case 'skipped':
      return `${head} skipped: ${row.reason.code} - ${row.reason.message}`
    case 'failed':
      return `${head} failed`
  }
}

/** The report as the lines an operator reads: one per Portal, then the totals. */
export function renderRepublishReport(
  report: RepublishLegacyPortalsReport,
): ReadonlyArray<string> {
  return [
    ...(report.rows.length === 0
      ? ['no live portal is still on a version 1 or 2 page']
      : report.rows.map(describeRow)),
    JSON.stringify(report.totals),
  ]
}

export function createRepublishLegacyPortalsAction(
  resolve: (container: Container) => RepublishLegacyPortals,
): OpsAction {
  return async (ctx, _args, io) => {
    const report = await resolve(ctx.container)({
      organizationId: organizationId(ctx.organizationId as string),
      propertyId: ctx.propertyId ? propertyId(ctx.propertyId) : undefined,
      operatorId: ctx.operatorId,
      dryRun: ctx.dryRun,
      pageSize: ctx.batchSize ?? REPUBLISH_LEGACY_PORTALS_SPEC.batchSize.default,
    })
    for (const line of renderRepublishReport(report)) io.out(line)
    if (report.halted) {
      io.err(`stopped at portal=${report.halted.portalId}: ${report.halted.fault}`)
      return 1
    }
    if (ctx.dryRun) {
      io.out('report only - re-run with --reason <text> --apply to republish')
    }
  }
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    REPUBLISH_LEGACY_PORTALS_SPEC,
    createRepublishLegacyPortalsAction(
      (container) => container.portalMaintenanceRuntime.republishLegacyPortals,
    ),
  )
  process.exitCode = result.exitCode
}

const entrypoint = process.argv[1]
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
    process.exitCode = 1
  })
}
