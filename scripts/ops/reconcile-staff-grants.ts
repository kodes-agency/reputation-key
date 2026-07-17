// Operator CLI (BQC-2.3): reconcile legacy staff assignments to proposed
// PropertyAccessGrants with a reviewable report (phase BQC-2 §2.3/§5).
//
// Usage:
//   pnpm ops:reconcile-grants                        — report only (review first)
//   pnpm ops:reconcile-grants --apply                — convert clean rows (source 'migration')
//   pnpm ops:reconcile-grants [--org <id> ...]       — scope to specific orgs
//
// Requires DATABASE_URL. Anomaly rows (org mismatch, inactive property,
// missing user) are reported and NEVER auto-converted. Apply is idempotent.

import { getDb } from '../../src/shared/db'
import {
  buildReconcileReport,
  applyReconciliation,
  type ReconcileReport,
} from '../../src/contexts/identity/infrastructure/repositories/reconcile-staff-grants.repository'

function printReport(report: ReconcileReport): void {
  console.log(
    `\nstaff→grant reconciliation report (${report.generatedAt.toISOString()})\n`,
  )
  console.log(
    'organization'.padEnd(28),
    'assignments'.padStart(11),
    'pairs'.padStart(7),
    'granted'.padStart(9),
    'toCreate'.padStart(9),
    'anomalies'.padStart(10),
  )
  for (const row of report.organizations) {
    console.log(
      row.organizationId.padEnd(28),
      String(row.activeAssignments).padStart(11),
      String(row.distinctPairs).padStart(7),
      String(row.alreadyGranted).padStart(9),
      String(row.toCreate).padStart(9),
      String(row.anomalies).padStart(10),
    )
  }
  if (report.anomalyRows.length > 0) {
    console.log(`\nanomalies (NOT converted — review required):`)
    for (const a of report.anomalyRows) {
      console.log(
        `  [${a.kind}] org=${a.organizationId} user=${a.userId} property=${a.propertyId} — ${a.detail}`,
      )
    }
  }
  console.log()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const orgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--org') {
      const id = args[i + 1]
      if (!id) {
        console.error('--org requires a value')
        process.exit(1)
      }
      orgs.push(id)
      i++
    }
  }
  const scope = orgs.length > 0 ? { organizationIds: orgs } : undefined

  const db = getDb()
  const report = await buildReconcileReport(db, scope)
  printReport(report)

  if (apply) {
    const result = await applyReconciliation(db, report, {
      createdBy: 'ops:reconcile-grants',
      scope,
    })
    console.log(`applied: ${result.created} grant(s) created (source 'migration')\n`)
  } else {
    console.log(`report only — re-run with --apply to convert clean rows\n`)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
