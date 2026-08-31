// Read-only GGL-01/CNV-01 inventory for the legacy Google import control row
// (`legacy_import_control`) and its effect leases (`legacy_import_effect_leases`),
// plus every foreign key that constrains their eventual contraction.
//
// The three GGL-01 compatibility mirrors (`gbp_cache`, `gbp_import_jobs`,
// `gbp_import_legacy_history`) are reported by
// `pnpm ops:report-compatibility-read-surfaces`, not here: they are
// compatibility_read and reviewed separately.
//
// The report contains schema metadata, counts, fixed classifications, and a
// fingerprint only; it never reads or emits an operator id, a worker id, or a
// closure reason. There is no apply mode.
//
// Usage:
//   pnpm ops:report-legacy-import-control --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalLegacyImportControlInventoryReport } from '../../src/contexts/integration/application/legacy-import-control-inventory'
import { readLegacyImportControlInventory } from '../../src/contexts/integration/infrastructure/legacy-import-control-inventory.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-import-control'
const USAGE = 'pnpm ops:report-legacy-import-control --operator <id> --as-of <ISO-8601>'

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
      const report = await readLegacyImportControlInventory(getDb(), asOf)
      io.out(canonicalLegacyImportControlInventoryReport(report))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
