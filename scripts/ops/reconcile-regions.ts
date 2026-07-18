// Operator CLI (BQC-4.1): reconcile property processing regions from
// authoritative country data with a reviewable report (phase BQC-4 §3/§4.1,
// ADR 0048).
//
// Usage:
//   pnpm ops:reconcile-regions                    — report only (review first)
//   pnpm ops:reconcile-regions --apply            — resolve `resolvable` rows
//   pnpm ops:reconcile-regions [--org <id>]       — scope to one org
//
// Requires DATABASE_URL. missing/conflict/ambiguous rows are reported and
// NEVER auto-converted — they need operator action (country correction via
// the property edit path, then re-run). Apply is idempotent.

import { getDb } from '../../src/shared/db'
import {
  buildRegionReconcileReport,
  applyRegionReconciliation,
  type RegionReconcileReport,
} from '../../src/contexts/property/infrastructure/repositories/reconcile-regions.repository'

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
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  let organizationId: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org') {
      const id = args[i + 1]
      if (!id) {
        console.error('--org requires a value')
        process.exit(1)
      }
      if (organizationId) {
        console.error('--org may be given only once')
        process.exit(1)
      }
      organizationId = id
      i++
    }
  }
  const scope = organizationId ? { organizationId } : undefined

  const db = getDb()
  const report = await buildRegionReconcileReport(db, scope)
  printReport(report)

  if (apply) {
    const result = await applyRegionReconciliation(db, report, { scope })
    console.log(`applied: ${result.applied} propert(ies) region-resolved\n`)
  } else {
    console.log(`report only — re-run with --apply to resolve clean rows\n`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
