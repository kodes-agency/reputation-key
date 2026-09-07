/**
 * LIF-01 program bullet 12 — the shared envelope for the read-only legacy
 * reconciliation reports.
 *
 * Bullet 12 asks for existing custom-role, multi-organization, Team and
 * legacy-Guest data to be reconciled or archived before migration WITHOUT
 * erasing the evidence needed to fix the conflicts. That second half is the
 * hard part, and it is why every report in this family is read-only: the rows
 * that make a conflict fixable are the same rows an eager cleanup would
 * delete. These commands count and classify; they never write.
 *
 * A finding is content-free by construction — an id, a severity, an integer
 * count and reviewed prose. No tenant identifier, role name, email or Guest
 * text is carried, so the JSON is safe to attach to a migration ticket. The
 * fingerprint lets an operator prove a later run observed the same state
 * without re-reading the underlying rows.
 */

import { createHash } from 'node:crypto'

export type ReconciliationSeverity =
  /** Migration cannot proceed correctly while the count is non-zero. */
  | 'blocks_migration'
  /** Someone must look, but the migration is not wrong without it. */
  | 'needs_review'
  /** Context that makes the other numbers interpretable. */
  | 'informational'

export type ReconciliationFinding = Readonly<{
  id: string
  severity: ReconciliationSeverity
  count: number
  /** What a non-zero count means in product terms. */
  meaning: string
  /** What has to happen before migration, stated as an action. */
  remediation: string
}>

export type ReconciliationReport = Readonly<{
  subject: string
  version: number
  asOf: string
  /** Structural, not a claim: these commands have no write path at all. */
  mutation: 'none'
  findings: ReadonlyArray<ReconciliationFinding>
  blockingFindingIds: ReadonlyArray<string>
  blocksMigration: boolean
  fingerprint: string
}>

/**
 * Fingerprints cover the observed state, not the run: subject, version and
 * every finding id/severity/count. Deliberately NOT `asOf` — two runs an hour
 * apart over unchanged data must fingerprint identically, otherwise the
 * fingerprint cannot be used to prove nothing moved.
 */
function fingerprintOf(
  subject: string,
  version: number,
  findings: ReadonlyArray<ReconciliationFinding>,
): string {
  const material = [
    subject,
    String(version),
    ...findings.map(({ id, severity, count }) => `${id}:${severity}:${count}`),
  ].join('|')
  return createHash('sha256').update(material).digest('hex')
}

export function buildReconciliationReport(
  input: Readonly<{
    subject: string
    version: number
    asOf: Date
    findings: ReadonlyArray<ReconciliationFinding>
  }>,
): ReconciliationReport {
  if (input.findings.length === 0) {
    throw new Error(`reconciliation report '${input.subject}' has no findings`)
  }
  const ids = input.findings.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    throw new Error(`reconciliation report '${input.subject}' has duplicate finding ids`)
  }
  // Sorted so the JSON and the fingerprint do not depend on the order the
  // queries happened to complete in.
  const findings = [...input.findings].sort((a, b) => a.id.localeCompare(b.id))
  const blockingFindingIds = findings
    .filter(({ severity, count }) => severity === 'blocks_migration' && count > 0)
    .map(({ id }) => id)

  return Object.freeze({
    subject: input.subject,
    version: input.version,
    asOf: input.asOf.toISOString(),
    mutation: 'none',
    findings: Object.freeze(findings),
    blockingFindingIds: Object.freeze(blockingFindingIds),
    blocksMigration: blockingFindingIds.length > 0,
    fingerprint: fingerprintOf(input.subject, input.version, findings),
  })
}

/** Stable JSON for an operator ticket or a migration evidence attachment. */
export function canonicalReconciliationReport(report: ReconciliationReport): string {
  return JSON.stringify(report, null, 2)
}
