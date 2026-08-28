// Operator CLI (BQC-2.3; harness BQC-7.5): reconcile legacy staff assignments
// to proposed PropertyAccessGrants with a reviewable report (phase BQC-2 §2.3/§5).
//
// Usage:
//   pnpm ops:reconcile-grants --operator <id>                          — report only (review first)
//   pnpm ops:reconcile-grants --operator <id> --reason <text> --apply  — convert clean rows (source 'migration')
//   pnpm ops:reconcile-grants --operator <id> [--org <id> ...]         — scope to specific orgs
//
// Requires DATABASE_URL. Anomaly rows (org mismatch, inactive property,
// missing user) are reported and NEVER auto-converted. Apply is idempotent.
// Every invocation is policy-evaluated + audited (the decision row records
// the last --org when given; the createdBy marker stays 'ops:reconcile-grants').

import { getDb } from '../../src/shared/db'
import {
  buildReconcileReport,
  applyReconciliation,
  type ReconcileReport,
} from '../../src/contexts/identity/infrastructure/repositories/reconcile-staff-grants.repository'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-grants --operator <id> [--org <id> ...] [--reason <text> --apply]'

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
  const result = await runOperatorCommand(
    {
      name: 'ops:reconcile-grants',
      scope: 'global', // --org optional (repeatable; narrows the report + policy scope)
      mutation: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const db = getDb()
      const scope =
        args.organizations.length > 0
          ? { organizationIds: args.organizations }
          : undefined
      const report = await buildReconcileReport(db, () => new Date(), scope)
      printReport(report)

      if (ctx.dryRun) {
        io.out(`report only — re-run with --apply to convert clean rows\n`)
        return
      }
      const applied = await applyReconciliation(db, report, {
        createdBy: 'ops:reconcile-grants',
        scope,
      })
      io.out(`applied: ${applied.created} grant(s) created (source 'migration')\n`)
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:reconcile-grants failed', err)
  process.exit(1)
})
