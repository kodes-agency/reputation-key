// Controlled people/team cutover. Report first; --apply converts only rows
// whose tenant/property parents and legacy relationships are unambiguous.
//
// Usage:
//   pnpm ops:reconcile-people-team --operator <id> [--org <id>]
//   pnpm ops:reconcile-people-team --operator <id> [--org <id>] --reason <text>
//     --apply --evidence <new-json-path>

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb } from '../../src/shared/db'
import {
  applyPeopleReconciliation,
  buildPeopleReconcileReport,
  type PeopleReconcileReport,
  type PeopleReconcileParity,
  verifyPeopleReconciliationParity,
} from '../../src/contexts/team/infrastructure/repositories/reconcile-people-team.repository'
import {
  canonicalPeopleCutoverEvidence,
  createPeopleCutoverEvidence,
  peopleCutoverEvidenceSha256,
} from '../../src/shared/release/people-cutover-evidence'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:reconcile-people-team --operator <id> [--org <id>] [--reason <text> --apply --evidence <new-json-path>]'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index === -1 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function harnessArgs(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--evidence') {
      index += 1
      continue
    }
    if (token.startsWith('--evidence=')) continue
    kept.push(token)
  }
  return kept
}

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

function printParity(parity: PeopleReconcileParity): void {
  const counts = parity.counts
  console.log(`people authority parity (${parity.checkedAt.toISOString()})`)
  console.log(
    `  participations ${counts.matchedParticipations}/${counts.expectedParticipations}; ` +
      `memberships ${counts.matchedMemberships}/${counts.expectedMemberships}; ` +
      `responsibilities ${counts.matchedResponsibilities}/${counts.expectedResponsibilities}; ` +
      `portal groups ${counts.matchedGroupMemberships}/${counts.expectedGroupMemberships}`,
  )
  console.log(
    `  anomalies=${counts.anomalies} missingMappings=${counts.missingMappings} exact=${String(parity.exact)}`,
  )
  for (const row of parity.issueRows) {
    console.log(
      `  [${row.kind}] org=${row.organizationId} property=${row.propertyId} source=${row.sourceId} — ${row.detail}`,
    )
  }
  console.log()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const evidencePath = flagValue(argv, '--evidence')
  if (argv.includes('--apply') && !evidencePath) {
    console.error(
      `ops:reconcile-people-team --apply requires --evidence <new-json-path>\nusage: ${USAGE}`,
    )
    process.exit(2)
  }
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
        const parity = await verifyPeopleReconciliationParity(db, scope)
        printParity(parity)
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
      const parity = await verifyPeopleReconciliationParity(db, scope)
      printParity(parity)
      if (!parity.exact) {
        io.err(
          'people authority cutover remains blocked — resolve every anomaly and missing mapping, then re-run',
        )
        return 1
      }
      const evidence = createPeopleCutoverEvidence({
        checkedAt: parity.checkedAt,
        scope: parity.scope,
        fingerprintSha256: parity.fingerprintSha256,
        counts: parity.counts,
        operator: { id: ctx.operatorId, correlationId: ctx.correlationId },
      })
      const content = canonicalPeopleCutoverEvidence(evidence)
      const path = resolve(evidencePath!)
      writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' })
      io.out(
        `stored cutover evidence: ${path} sha256=${peopleCutoverEvidenceSha256(content)}\n`,
      )
    },
    harnessArgs(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error('ops:reconcile-people-team failed', error)
  process.exit(1)
})
