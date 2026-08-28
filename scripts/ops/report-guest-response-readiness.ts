// Read-only GST-01 Guest Response legacy-readiness reconciliation. The
// mandatory observation time makes unchanged-data reruns byte-for-byte
// comparable; output is identifier-only and has no apply path.
//
// Usage:
//   pnpm ops:report-guest-response-readiness --operator <id>
//     --observed-at <ISO-8601> [--org <id> ...]

import { canonicalGuestResponseReconciliationReport } from '../../src/contexts/guest/application/guest-response-reconciliation'
import { buildGuestResponseReconciliationReportFromDatabase } from '../../src/contexts/guest/infrastructure/repositories/guest-response-reconciliation.repository'
import { getDb } from '../../src/shared/db'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-guest-response-readiness'
const USAGE =
  'pnpm ops:report-guest-response-readiness --operator <id> --observed-at <ISO-8601> [--org <id> ...]'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index < 0 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function withoutObservedAt(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--observed-at') {
      index += 1
      continue
    }
    if (!token.startsWith('--observed-at=')) kept.push(token)
  }
  return kept
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const rawObservedAt = flagValue(argv, '--observed-at')
  const observedAt = rawObservedAt ? new Date(rawObservedAt) : null
  if (!observedAt || Number.isNaN(observedAt.getTime())) {
    console.error(`--observed-at must be a valid ISO-8601 value\nusage: ${USAGE}`)
    process.exit(2)
  }

  const result = await runOperatorCommand(
    { name: COMMAND_NAME, scope: 'global', mutation: false, usage: USAGE },
    async (_context, args, io) => {
      const report = await buildGuestResponseReconciliationReportFromDatabase(getDb(), {
        observedAt,
        organizationIds: args.organizations.length > 0 ? args.organizations : undefined,
      })
      io.out(canonicalGuestResponseReconciliationReport(report))
    },
    withoutObservedAt(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
