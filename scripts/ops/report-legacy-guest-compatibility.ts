// LIF-01 bullet 12 — read-only reconciliation report for the pre-beta Guest
// rows held in the `ratings`, `feedback` and `scan_events` compatibility
// mirrors.
//
// This is NOT a contraction inventory. `ops:report-compatibility-read-surfaces`
// owns the row and foreign-key inventory that a future contraction decision
// rests on, and this command deliberately does not restate it. The question
// here is different: how much of the legacy population can still be reconciled
// to the canonical Guest Response model, and how much has already lost the
// session pseudonym that is the only handle anyone could correlate it by.
//
// That number only moves one way. The session binding expires 24 hours after
// submission and the sweep redacts the mirror `session_id` on the same clock,
// so every unreconciled legacy row eventually becomes permanently
// unreconcilable. Reporting it is how that deadline stays visible.
//
// Content-free: counts, severities and a state fingerprint. No guest text,
// pseudonym, portal id or organization id is selected, and there is no apply
// flag or write path. Removing a mirror row would perform the CNV-01
// contraction early, before the one verified release plus restore proof the
// mirrors are gated on.
//
// Usage:
//   pnpm ops:report-legacy-guest-compatibility --operator <id> --as-of <ISO-8601>

import { getDb } from '../../src/shared/db'
import { canonicalReconciliationReport } from '../../src/shared/db/retention/reconciliation-report'
import { readLegacyGuestCompatibilityInventory } from '../../src/shared/db/retention/legacy-reconciliation-inventories'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-legacy-guest-compatibility'
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
      const report = await readLegacyGuestCompatibilityInventory(getDb(), asOf)
      io.out(canonicalReconciliationReport(report))
      io.out(
        'mirror rows are never deleted by this command; contraction stays blocked until one verified release plus a restore proof',
      )
    },
    withoutAsOf(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
