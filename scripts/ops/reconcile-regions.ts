// Operator CLI (BQC-4.1; harness BQC-7.5): reconcile property processing
// regions from authoritative country data with a reviewable report
// (phase BQC-4 §3/§4.1, ADR 0048).
//
// Usage:
//   pnpm ops:reconcile-regions --operator <id>                          — report only (review first)
//   pnpm ops:reconcile-regions --operator <id> --reason <text> --apply  — resolve `resolvable` rows
//   pnpm ops:reconcile-regions --operator <id> [--org <id>]             — scope to one org
//
// Requires DATABASE_URL. missing/conflict/ambiguous rows are reported and
// NEVER auto-converted — they need operator action (country correction via
// the property edit path, then re-run). Apply is idempotent. Every
// invocation is policy-evaluated + audited (decision row via the BQC-7.5
// harness; the audit row records the org scope when --org is given).

import { getDb } from '../../src/shared/db'
import {
  buildRegionReconcileReport,
  applyRegionReconciliation,
  type RegionReconcileReport,
} from '../../src/contexts/property/infrastructure/repositories/reconcile-regions.repository'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-regions --operator <id> [--org <id>] [--reason <text> --apply]'

function printReport(report: RegionReconcileReport): void {
  console.log(
    `\nproperty region reconciliation report (${report.generatedAt.toISOString()})\n`,
  )
  console.log(
    'organization'.padEnd(28),
    'properties'.padStart(11),
    'resolved'.padStart(9),
    'resolvable'.padStart(11),
    'missing'.padStart(8),
    'conflict'.padStart(9),
    'ambiguous'.padStart(10),
  )
  for (const row of report.organizations) {
    console.log(
      row.organizationId.padEnd(28),
      String(row.properties).padStart(11),
      String(row.resolved).padStart(9),
      String(row.resolvable).padStart(11),
      String(row.missing).padStart(8),
      String(row.conflicts).padStart(9),
      String(row.ambiguous).padStart(10),
    )
  }
  if (report.reviewRows.length > 0) {
    console.log(`\noperator review required (NOT converted):`)
    for (const r of report.reviewRows) {
      console.log(
        `  [${r.classification}] org=${r.organizationId} property=${r.propertyId} — ${r.detail}`,
      )
    }
  }
  console.log()
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:reconcile-regions',
      scope: 'global', // --org optional (narrows the report + the policy scope)
      mutation: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const db = getDb()
      const scope = args.organizationId
        ? { organizationId: args.organizationId }
        : undefined
      const report = await buildRegionReconcileReport(db, () => new Date(), scope)
      printReport(report)

      if (ctx.dryRun) {
        io.out(`report only — re-run with --apply to resolve clean rows\n`)
        return
      }
      const applied = await applyRegionReconciliation(db, report, { scope })
      io.out(`applied: ${applied.applied} propert(ies) region-resolved\n`)
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:reconcile-regions failed', err)
  process.exit(1)
})
