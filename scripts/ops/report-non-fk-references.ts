// Read-only CNV-01 scan for the references PostgreSQL will never defend:
// uuid columns declared without a foreign key, (resource_type, resource_id)
// pairs, textual aggregate identifiers, and identifiers embedded in jsonb
// documents. A foreign key is the only reference the database protects; these
// survive the row they name and become dangling the moment a contraction slice
// runs.
//
// The report carries counts and column identifiers only — never a referenced
// identifier value. There is no apply mode.
//
// Usage:
//   pnpm ops:report-non-fk-references --operator <id> --as-of <ISO-8601> [--table <name>]...
//
// With no --table flag the scan covers every contraction candidate, which is
// the slowest form: the jsonb probes are substring searches over whole
// documents. Pass --table for the slice actually being reviewed.

import { getDb } from '../../src/shared/db'
import { contractionCandidateTableNames } from '../../src/shared/governance/contraction-inventory-registry'
import { scanNonFkReferences } from '../../src/shared/db/governance/non-fk-reference-scanner.repository'
import { canonicalNonFkReferenceScanReport } from '../../src/shared/governance/non-fk-reference-surfaces'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-non-fk-references'
const USAGE =
  'pnpm ops:report-non-fk-references --operator <id> --as-of <ISO-8601> [--table <name>]...'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index < 0 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function flagValues(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === name) {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) values.push(next)
      continue
    }
    if (token.startsWith(`${name}=`)) values.push(token.slice(name.length + 1))
  }
  return values
}

function withoutScanFlags(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--as-of' || token === '--table') {
      index += 1
      continue
    }
    if (!token.startsWith('--as-of=') && !token.startsWith('--table=')) kept.push(token)
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

  const candidateTables = contractionCandidateTableNames()
  const requested = flagValues(argv, '--table')
  const unknown = requested.filter((table) => !candidateTables.includes(table))
  if (unknown.length > 0) {
    // Failing here rather than scanning an unclassified table keeps the report
    // aligned with the persisted-model authority.
    console.error(
      `--table must name a contraction candidate; unknown: ${unknown.join(', ')}\nusage: ${USAGE}`,
    )
    process.exit(2)
  }

  const result = await runOperatorCommand(
    { name: COMMAND_NAME, scope: 'global', mutation: false, usage: USAGE },
    async (_context, _args, io) => {
      const report = await scanNonFkReferences(getDb(), {
        evaluatedAt: asOf,
        referentTables: requested.length > 0 ? requested : candidateTables,
        candidateTables,
      })
      io.out(canonicalNonFkReferenceScanReport(report))
    },
    withoutScanFlags(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
