// Read-only MET-01/CNV-01 inventory for the four retained legacy Metric
// rollup tables (`rollup_daily_metrics`, `rollup_weekly_metrics`,
// `rollup_daily_inbox_metrics`, `_rollup_watermarks`) and every foreign key
// that constrains their eventual contraction.
//
// The report contains schema metadata, counts, fixed classifications, and a
// fingerprint only; it never reads or emits retained record content. There is
// no apply mode: physical contraction stays blocked until one verified release
// plus a restore proof.
//
// Usage:
//   pnpm ops:report-legacy-rollups --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalLegacyRollupInventoryReport } from '../../src/contexts/metric/application/legacy-rollup-inventory'
import { readLegacyRollupInventory } from '../../src/contexts/metric/infrastructure/legacy-rollup-inventory.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-rollups'
const USAGE = 'pnpm ops:report-legacy-rollups --operator <id> --as-of <ISO-8601>'

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
      const report = await readLegacyRollupInventory(getDb(), asOf)
      io.out(canonicalLegacyRollupInventoryReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
