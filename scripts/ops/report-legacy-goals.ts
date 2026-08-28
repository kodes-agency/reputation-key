// Read-only GOA-01/CNV-01 inventory for the two retained pre-beta Goal
// tables and every foreign key that constrains their eventual contraction.
// The report contains schema metadata, counts, fixed classifications, and a
// fingerprint only; it never reads or emits retained record content.
//
// Usage:
//   pnpm ops:report-legacy-goals --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalLegacyGoalInventoryReport } from '../../src/contexts/goal/application/legacy-goal-inventory'
import { readLegacyGoalInventory } from '../../src/contexts/goal/infrastructure/legacy-goal-inventory.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-goals'
const USAGE = 'pnpm ops:report-legacy-goals --operator <id> --as-of <ISO-8601>'

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
      const report = await readLegacyGoalInventory(getDb(), asOf)
      io.out(canonicalLegacyGoalInventoryReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
