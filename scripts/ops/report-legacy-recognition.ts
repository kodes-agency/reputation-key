// Read-only REC-01 inventory for every retained Badge, Leaderboard, and
// governed Recognition table plus the foreign keys that constrain deletion.
// Version 3 collects reconstructable schema-qualified inbound/outbound FK
// metadata and counts in one read-only repeatable-read snapshot. Output contains
// only schema metadata, counts, fixed classifications, and a fingerprint; it
// never selects record identifiers, names, criteria, scores, or user data.
//
// Usage:
//   pnpm ops:report-legacy-recognition --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalLegacyRecognitionInventoryReport } from '../../src/contexts/leaderboard/application/public-api'
import { readLegacyRecognitionInventory } from '../../src/contexts/leaderboard/infrastructure/legacy-recognition-inventory.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-recognition'
const USAGE = 'pnpm ops:report-legacy-recognition --operator <id> --as-of <ISO-8601>'

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
      const report = await readLegacyRecognitionInventory(getDb(), asOf)
      io.out(canonicalLegacyRecognitionInventoryReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
