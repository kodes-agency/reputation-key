// Read-only CNV-01 inventory of every `compatibility_read` mirror: the
// pre-beta guest tables (feedback, ratings, scan_events), the legacy Google
// import mirrors (gbp_import_legacy_history, gbp_cache, gbp_import_jobs) and
// the pre-beta portal group membership mirror (portal_group_members).
//
// The hard rule blocks removing a mirror until one verified release plus a
// restore proof, so `schemaContractionCandidate` is false by construction. The
// rule blocks the removal, not the inventory — and without the inventory there
// is no evidence base from which the block could ever be lifted.
//
// The report contains schema metadata, counts, reader counts, fixed
// classifications, and a fingerprint only; it never reads guest content. There
// is no apply mode.
//
// Usage:
//   pnpm ops:report-compatibility-read-surfaces --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalCompatibilityReadInventoryReport } from '../../src/contexts/guest/application/compatibility-read-inventory'
import { readCompatibilityReadInventory } from '../../src/contexts/guest/infrastructure/compatibility-read-inventory.repository'
import { readLegacyGbpCompatibilitySection } from '../../src/contexts/integration/infrastructure/legacy-gbp-compatibility-inventory.repository'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-compatibility-read-surfaces'
const USAGE =
  'pnpm ops:report-compatibility-read-surfaces --operator <id> --as-of <ISO-8601>'

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
      const db = getDb()
      const report = await readCompatibilityReadInventory(db, asOf)
      // The Integration context owns the physical-name/Drizzle-export mapping
      // for its three mirrors; carrying it in the same artifact keeps the
      // naming trap visible to whoever reads the evidence later.
      const gbpCompatibility = await readLegacyGbpCompatibilitySection(db, asOf)
      io.out(canonicalCompatibilityReadInventoryReport(report))
      io.out(JSON.stringify({ gbpCompatibility }, null, 2))
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
