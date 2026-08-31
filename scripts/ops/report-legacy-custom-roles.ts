// LIF-01 bullet 12 — read-only audit of the custom-role records that spec
// §3.1.3 requires to be mapped to built-ins before migration.
//
// Runtime custom roles are off for beta and dormant schema may remain, so the
// report separates a harmless dormant DEFINITION from a member or a pending
// invitation actually holding a custom role. Only the second kind blocks
// migration.
//
// Content-free: counts, severities and a state fingerprint. Role names,
// organization ids and user ids are never selected. There is no apply flag and
// no write path — the custom role name on a member row is often the only
// surviving evidence of what access was intended, so nothing here removes it.
//
// Usage:
//   pnpm ops:report-legacy-custom-roles --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalReconciliationReport } from '../../src/shared/db/retention/reconciliation-report'
import { readLegacyCustomRoleInventory } from '../../src/shared/db/retention/legacy-reconciliation-inventories'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-custom-roles'
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
      const report = await readLegacyCustomRoleInventory(getDb(), asOf)
      io.out(canonicalReconciliationReport(report))
      if (report.blocksMigration) {
        io.out(
          `migration blocked by: ${report.blockingFindingIds.join(', ')} — map each holder to a built-in role with a recorded decision`,
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
