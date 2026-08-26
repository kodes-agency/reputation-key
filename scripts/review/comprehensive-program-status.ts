import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

const sha = z.string().regex(/^[0-9a-f]{40}$/u)
const evidenceList = z.array(z.string().trim().min(1))

const completionRecord = z
  .object({
    package: z.string().regex(/^[A-Z]+-\d{2}$/u),
    frozen_sha: sha,
    owner: z.string().trim().min(1),
    reviewer: z.string().trim().min(1),
    authority_revisions: evidenceList,
    findings_closed: evidenceList,
    findings_deferred_with_reason: evidenceList,
    entry_points_changed: evidenceList,
    write_paths_and_facts: evidenceList,
    migrations_and_backfills: evidenceList,
    test_and_fault_evidence: evidenceList,
    railway_cells_exercised: evidenceList,
    observability_and_runbook: evidenceList,
    rollout_and_rollback_result: evidenceList,
    data_privacy_review: evidenceList,
    known_residual_risk: evidenceList,
  })
  .strict()

const packageStatusRow = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    status: z.enum([
      'not_started',
      'partial',
      'code_complete',
      'evidence_complete',
      'blocked_external',
    ]),
    summary: z.string().trim().min(1),
    codeEvidence: evidenceList,
    testEvidence: evidenceList,
    remaining: evidenceList,
    externalBlockers: evidenceList,
    completionRecord: completionRecord.optional(),
  })
  .strict()

const comprehensiveProgramStatus = z
  .object({
    version: z.literal(1),
    baselineSha: sha,
    assessedAt: z.iso.date(),
    packages: z.array(packageStatusRow),
  })
  .strict()

function packageIdsFromPlan(plan: string): readonly string[] {
  return [...plan.matchAll(/^### ([A-Z]+-\d{2}) — /gmu)].map((match) => match[1]!)
}

export function validateComprehensiveProgramStatus(
  plan: string,
  input: unknown,
): readonly string[] {
  const ledger = comprehensiveProgramStatus.parse(input)
  const planIds = packageIdsFromPlan(plan)
  const ledgerIds = ledger.packages.map(({ id }) => id)

  if (planIds.length === 0) throw new Error('implementation plan contains no packages')
  if (new Set(planIds).size !== planIds.length) {
    throw new Error('implementation plan contains duplicate package ids')
  }
  if (JSON.stringify(ledgerIds) !== JSON.stringify(planIds)) {
    throw new Error(
      `program status must contain every package exactly once in plan order; expected ${planIds.join(', ')}`,
    )
  }

  for (const row of ledger.packages) {
    if (row.status === 'blocked_external' && row.externalBlockers.length === 0) {
      throw new Error(`${row.id} blocked_external status must name its externalBlockers`)
    }
    if (row.status === 'not_started' && row.remaining.length === 0) {
      throw new Error(`${row.id} not_started status must name the work remaining`)
    }
    if (row.status === 'partial' && row.remaining.length === 0) {
      throw new Error(`${row.id} partial status must name the work remaining`)
    }
    if (row.status !== 'evidence_complete') continue
    if (!row.completionRecord) {
      throw new Error(`${row.id} cannot be evidence_complete without a completionRecord`)
    }
    if (row.completionRecord.package !== row.id) {
      throw new Error(`${row.id} completionRecord names a different package`)
    }
    if (row.completionRecord.frozen_sha !== ledger.baselineSha) {
      throw new Error(`${row.id} completionRecord names a different frozen SHA`)
    }
    if (row.completionRecord.owner === row.completionRecord.reviewer) {
      throw new Error(`${row.id} completionRecord requires an independent reviewer`)
    }
    if (
      row.codeEvidence.length === 0 ||
      row.testEvidence.length === 0 ||
      row.remaining.length > 0 ||
      row.externalBlockers.length > 0
    ) {
      throw new Error(`${row.id} evidence_complete claim has unresolved evidence gaps`)
    }
  }

  return planIds
}

export function runComprehensiveProgramStatusCli(args: readonly string[]): number {
  try {
    const planPath = resolve(
      args[0] ?? 'docs/comprehensive-beta-implementation-program-2026-08-25.md',
    )
    const ledgerPath = resolve(
      args[1] ??
        'docs/release-evidence/review/comprehensive-program-status-2026-08-26.json',
    )
    const plan = readFileSync(planPath, 'utf8')
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as unknown
    const packageIds = validateComprehensiveProgramStatus(plan, ledger)
    const status = comprehensiveProgramStatus.parse(ledger)
    const counts = Object.fromEntries(
      [
        'not_started',
        'partial',
        'code_complete',
        'evidence_complete',
        'blocked_external',
      ].map((state) => [
        state,
        status.packages.filter((row) => row.status === state).length,
      ]),
    )
    process.stdout.write(`${JSON.stringify({ packages: packageIds.length, counts })}\n`)
    return 0
  } catch (error) {
    process.stderr.write(
      `comprehensive program status invalid: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runComprehensiveProgramStatusCli(process.argv.slice(2))
}
