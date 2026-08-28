// Read-only POR-01 legacy Portal inventory. An explicit cutoff makes unchanged
// reruns byte-for-byte comparable; output contains identifiers, reason codes,
// counts, and a fingerprint only.
//
// Usage:
//   pnpm ops:report-portal-beta-readiness --operator <id> --as-of <ISO-8601>
//     [--org <id> ...]

import { getDb } from '../../src/shared/db'
import { canonicalPortalBetaReadinessReport } from '../../src/contexts/portal/application/portal-beta-readiness-reconciliation'
import { buildPortalBetaReadinessReportFromDatabase } from '../../src/contexts/portal/infrastructure/repositories/portal-beta-readiness-reconciliation.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-portal-beta-readiness'
const USAGE =
  'pnpm ops:report-portal-beta-readiness --operator <id> --as-of <ISO-8601> [--org <id> ...]'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index < 0 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function withoutAsOf(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--as-of') {
      index += 1
      continue
    }
    if (!token.startsWith('--as-of=')) kept.push(token)
  }
  return kept
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const rawAsOf = flagValue(argv, '--as-of')
  const asOf = rawAsOf ? new Date(rawAsOf) : null
  if (!asOf || Number.isNaN(asOf.getTime())) {
    console.error(`--as-of must be a valid ISO-8601 value\nusage: ${USAGE}`)
    process.exit(2)
  }

  const result = await runOperatorCommand(
    { name: COMMAND_NAME, scope: 'global', mutation: false, usage: USAGE },
    async (_context, args, io) => {
      const report = await buildPortalBetaReadinessReportFromDatabase(getDb(), {
        asOf,
        organizationIds: args.organizations.length > 0 ? args.organizations : undefined,
      })
      io.out(canonicalPortalBetaReadinessReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
