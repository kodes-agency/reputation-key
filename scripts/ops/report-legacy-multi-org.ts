// LIF-01 bullet 12 — read-only audit of the multi-Organization membership
// records spec §3.1.4 requires to be reconciled before migration.
//
// A beta user has one active Organization Membership total. The binding table
// makes a second simultaneous active binding unrepresentable, so this report
// looks where the invariant cannot reach: legacy `member` rows the binding
// never captured, active bindings that disagree with the memberships they
// summarize, and pending invitations that would recreate the conflict on
// accept.
//
// Content-free: counts, severities and a state fingerprint. No user id, email
// or organization id is selected. There is no apply flag and no write path —
// which membership is the active one is a support decision, and deleting the
// losing row would destroy the evidence that decision needs.
//
// Usage:
//   pnpm ops:report-legacy-multi-org --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalReconciliationReport } from '../../src/shared/db/retention/reconciliation-report'
import { readLegacyMultiOrganizationInventory } from '../../src/shared/db/retention/legacy-reconciliation-inventories'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-multi-org'
const USAGE = `pnpm ${COMMAND_NAME} --operator <id> --as-of <ISO-8601>`

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
    async (_context, _args, io) => {
      const report = await readLegacyMultiOrganizationInventory(getDb(), asOf)
      io.out(canonicalReconciliationReport(report))
      if (report.blocksMigration) {
        io.out(
          `migration blocked by: ${report.blockingFindingIds.join(', ')} — resolve each user to one active Organization through support before migrating`,
        )
      }
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
