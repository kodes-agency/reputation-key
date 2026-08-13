// Controlled people/team cutover. Report first; --apply converts only rows
// whose tenant/property parents and legacy relationships are unambiguous.
//
// Usage:
//   pnpm ops:reconcile-people-team --operator <id> [--org <id>]
//   pnpm ops:reconcile-people-team --operator <id> [--org <id>] --reason <text> --apply

import { getDb } from '../../src/shared/db'
import {
  applyPeopleReconciliation,
  buildPeopleReconcileReport,
  type PeopleReconcileReport,
} from '../../src/contexts/team/infrastructure/repositories/reconcile-people-team.repository'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-people-team --operator <id> [--org <id>] [--reason <text> --apply]'

function printReport(report: PeopleReconcileReport): void {
  console.log(
    `\npeople/team reconciliation report (${report.generatedAt.toISOString()})\n`,
  )
  console.log(
    'organization'.padEnd(28),
    'legacy'.padStart(8),
    'people'.padStart(8),
    'members'.padStart(9),
    'portals'.padStart(9),
    'groups'.padStart(8),
    'quarantine'.padStart(12),
  )
  for (const row of report.organizations) {
    console.log(
      row.organizationId.padEnd(28),
      String(row.activeAssignments).padStart(8),
      String(row.participationCandidates).padStart(8),
      String(row.membershipCandidates).padStart(9),
      String(row.responsibilityCandidates).padStart(9),
      String(row.groupMembershipCandidates).padStart(8),
      String(row.anomalies).padStart(12),
    )
  }
  if (report.anomalyRows.length > 0) {
    console.log('\noperator review required (NOT converted):')
    for (const row of report.anomalyRows) {
      console.log(
        `  [${row.kind}] org=${row.organizationId} property=${row.propertyId} user=${row.userId ?? '-'} source=${row.sourceId} — ${row.detail}`,
      )
    }
  }
  console.log()
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:reconcile-people-team',
      scope: 'global',
      mutation: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const db = getDb()
      const scope = args.organizationId
        ? { organizationIds: [args.organizationId] }
        : undefined
      const report = await buildPeopleReconcileReport(db, scope)
      printReport(report)
      if (ctx.dryRun) {
        io.out(
          'report only — correct quarantined rows, then re-run; use --apply for clean rows\n',
        )
        return
      }
      const applied = await applyPeopleReconciliation(db, report, {
        createdBy: `ops:reconcile-people-team:${ctx.operatorId}`,
        scope,
      })
      io.out(
        `applied: ${applied.participationsCreated} participation(s), ${applied.membershipsCreated} membership(s), ${applied.leadsPromoted} lead promotion(s), ${applied.responsibilitiesCreated} portal responsibility row(s), ${applied.groupMembershipsCreated} portal-group interval(s)\n`,
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error('ops:reconcile-people-team failed', error)
  process.exit(1)
})
