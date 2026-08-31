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

const implementationProgress = z
  .object({
    status: z.enum(['not_started', 'in_progress', 'complete']),
    remaining: evidenceList,
  })
  .strict()

const repositoryVerificationProgress = z
  .object({
    status: z.enum(['not_started', 'in_progress', 'passed']),
    remaining: evidenceList,
  })
  .strict()

const externalVerificationProgress = z
  .object({
    status: z.enum(['not_required', 'not_started', 'in_progress', 'blocked', 'passed']),
    remaining: evidenceList,
    blockers: evidenceList,
  })
  .strict()

const packageStatusRow = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    summary: z.string().trim().min(1),
    implementation: implementationProgress,
    repositoryVerification: repositoryVerificationProgress,
    externalVerification: externalVerificationProgress,
    codeEvidence: evidenceList,
    testEvidence: evidenceList,
    completionRecord: completionRecord.optional(),
  })
  .strict()

const comprehensiveProgramStatus = z
  .object({
    version: z.literal(2),
    baselineSha: sha,
    assessedAt: z.iso.date(),
    packages: z.array(packageStatusRow),
  })
  .strict()

function packageIdsFromPlan(plan: string): readonly string[] {
  return [...plan.matchAll(/^### ([A-Z]+-\d{2}) — /gmu)].map((match) => match[1]!)
}

type PackageStatusRow = z.infer<typeof packageStatusRow>

function assertPlanAlignment(planIds: readonly string[], ledgerIds: readonly string[]) {
  if (planIds.length === 0) throw new Error('implementation plan contains no packages')
  if (new Set(planIds).size !== planIds.length) {
    throw new Error('implementation plan contains duplicate package ids')
  }
  if (JSON.stringify(ledgerIds) !== JSON.stringify(planIds)) {
    throw new Error(
      `program status must contain every package exactly once in plan order; expected ${planIds.join(', ')}`,
    )
  }
}

function assertImplementationAxis(row: PackageStatusRow): void {
  if (
    row.implementation.status === 'complete' &&
    row.implementation.remaining.length > 0
  ) {
    throw new Error(`${row.id} complete implementation cannot name remaining work`)
  }
  if (
    row.implementation.status !== 'complete' &&
    row.implementation.remaining.length === 0
  ) {
    throw new Error(`${row.id} unfinished implementation must name remaining work`)
  }
}

function assertRepositoryVerificationAxis(row: PackageStatusRow): void {
  if (
    row.repositoryVerification.status === 'passed' &&
    (row.repositoryVerification.remaining.length > 0 || row.testEvidence.length === 0)
  ) {
    throw new Error(`${row.id} passed repository verification has evidence gaps`)
  }
  if (
    row.repositoryVerification.status !== 'passed' &&
    row.repositoryVerification.remaining.length === 0
  ) {
    throw new Error(
      `${row.id} unfinished repository verification must name remaining work`,
    )
  }
  if (
    row.repositoryVerification.status === 'passed' &&
    row.implementation.status !== 'complete'
  ) {
    throw new Error(`${row.id} cannot pass repository verification before implementation`)
  }
}

function assertExternalVerificationAxis(row: PackageStatusRow): void {
  const external = row.externalVerification
  if (external.status === 'blocked' && external.blockers.length === 0) {
    throw new Error(`${row.id} blocked external verification must name its blockers`)
  }
  const carriesWork = external.remaining.length > 0 || external.blockers.length > 0
  if (external.status === 'not_required' && carriesWork) {
    throw new Error(`${row.id} not-required external verification cannot carry work`)
  }
  if (external.status === 'passed' && carriesWork) {
    throw new Error(`${row.id} passed external verification has unresolved work`)
  }
  if (
    ['not_started', 'in_progress'].includes(external.status) &&
    external.remaining.length === 0
  ) {
    throw new Error(`${row.id} unfinished external verification must name remaining work`)
  }
}

/**
 * A completion record may exist only once all three axes close, and must then
 * name this package, the assessed baseline, an independent reviewer, and evidence.
 */
function assertCompletionRecord(row: PackageStatusRow, baselineSha: string): void {
  const formallyComplete =
    row.implementation.status === 'complete' &&
    row.repositoryVerification.status === 'passed' &&
    ['not_required', 'passed'].includes(row.externalVerification.status)
  if (!formallyComplete) {
    if (row.completionRecord) {
      throw new Error(`${row.id} cannot publish a completionRecord before all axes close`)
    }
    return
  }
  if (!row.completionRecord) {
    throw new Error(`${row.id} cannot close without a completionRecord`)
  }
  if (row.completionRecord.package !== row.id) {
    throw new Error(`${row.id} completionRecord names a different package`)
  }
  if (row.completionRecord.frozen_sha !== baselineSha) {
    throw new Error(`${row.id} completionRecord names a different frozen SHA`)
  }
  if (row.completionRecord.owner === row.completionRecord.reviewer) {
    throw new Error(`${row.id} completionRecord requires an independent reviewer`)
  }
  if (row.codeEvidence.length === 0 || row.testEvidence.length === 0) {
    throw new Error(`${row.id} completed package has unresolved evidence gaps`)
  }
}

export function validateComprehensiveProgramStatus(
  plan: string,
  input: unknown,
): readonly string[] {
  const ledger = comprehensiveProgramStatus.parse(input)
  const planIds = packageIdsFromPlan(plan)

  assertPlanAlignment(
    planIds,
    ledger.packages.map(({ id }) => id),
  )

  for (const row of ledger.packages) {
    assertImplementationAxis(row)
    assertRepositoryVerificationAxis(row)
    assertExternalVerificationAxis(row)
    assertCompletionRecord(row, ledger.baselineSha)
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
    const countAxis = (values: readonly string[]) =>
      Object.fromEntries(values.map((value) => [value, 0]))
    const counts = {
      implementation: countAxis(['not_started', 'in_progress', 'complete']),
      repositoryVerification: countAxis(['not_started', 'in_progress', 'passed']),
      externalVerification: countAxis([
        'not_required',
        'not_started',
        'in_progress',
        'blocked',
        'passed',
      ]),
    }
    for (const row of status.packages) {
      counts.implementation[row.implementation.status]! += 1
      counts.repositoryVerification[row.repositoryVerification.status]! += 1
      counts.externalVerification[row.externalVerification.status]! += 1
    }
    const formallyComplete = status.packages.filter(
      (row) => row.completionRecord !== undefined,
    ).length
    process.stdout.write(
      `${JSON.stringify({ packages: packageIds.length, counts, formalClosure: { complete: formallyComplete, open: packageIds.length - formallyComplete } })}\n`,
    )
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
