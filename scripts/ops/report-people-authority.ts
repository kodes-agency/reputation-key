// Read-only people authority reconciliation. The explicit observation time
// makes reruns against unchanged data byte-for-byte comparable.
//
// Usage:
//   pnpm exec tsx scripts/ops/report-people-authority.ts \
//     --operator <id> --as-of <ISO-8601> [--org <id> ...]

import { getDb } from '../../src/shared/db'
import { canonicalPeopleAuthorityReconciliationReport } from '../../src/contexts/identity/application/people-authority-reconciliation.server'
import { buildPeopleAuthorityReconciliationReportFromDatabase } from '../../src/contexts/identity/infrastructure/repositories/people-authority-reconciliation.repository'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm exec tsx scripts/ops/report-people-authority.ts --operator <id> --as-of <ISO-8601> [--org <id> ...]'

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
  const value = flagValue(argv, '--as-of')
  const asOf = value ? new Date(value) : null
  if (!asOf || Number.isNaN(asOf.getTime())) {
    console.error(`--as-of must be a valid ISO-8601 value\nusage: ${USAGE}`)
    process.exit(2)
  }

  const result = await runOperatorCommand(
    {
      name: 'ops:report-people-authority',
      scope: 'global',
      mutation: false,
      usage: USAGE,
    },
    async (_ctx, args, io) => {
      const report = await buildPeopleAuthorityReconciliationReportFromDatabase(getDb(), {
        asOf,
        organizationIds: args.organizations.length > 0 ? args.organizations : undefined,
      })
      io.out(canonicalPeopleAuthorityReconciliationReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error('ops:report-people-authority failed', error)
  process.exit(1)
})
