// Read-only IBX-01 Inbox Handling-Cycle cutover/parity evidence. The command
// classifies every legacy `inbox_items` row against the Handling Cycle tables
// (exact | mappable | ambiguous | orphan), reconciles head coverage, the
// compatibility status mirror, and Response Target lineage, and prints ONE
// canonical JSON envelope for the signed runbook at
// docs/operations/inbox-handling-cycle-cutover.md.
//
// It is a read: there is no --apply path, the repository refuses to write, and
// `mappable` in the output is a finding, never permission to migrate. The
// mandatory --observed-at makes an unchanged-data rerun byte-for-byte
// comparable, so two operators can diff instead of trusting one run.
//
// The digest is computed HERE and injected into the pure report builder: the
// Inbox public API is reachable from browser code and must not pull in
// node:crypto (ADR 0017), so the operator edge supplies the real SHA-256.
//
// Usage:
//   pnpm ops:report-inbox-handling-cutover --operator <id> --org <id>
//     --observed-at <ISO-8601>

import { createHash } from 'node:crypto'
import { canonicalInboxHandlingCutoverReport } from '../../src/contexts/inbox/application/public-api'
import { readInboxHandlingCutoverScan } from '../../src/contexts/inbox/infrastructure/repositories/inbox-handling-cutover.repository'
import { canonicalizeRfc8785 } from '../../src/shared/canonical-json'
import { getDb } from '../../src/shared/db'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-inbox-handling-cutover'
const USAGE =
  'pnpm ops:report-inbox-handling-cutover --operator <id> --org <id> --observed-at <ISO-8601>'

/** Beta runs exactly one logical US Data Cell; evidence is scoped to it. */
const DATA_CELL_ID = 'cell-us' as const

const EVIDENCE_VERSION = 'inbox-handling-cutover-evidence/v1'

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const next = index < 0 ? undefined : args[index + 1]
  return next?.startsWith('--') ? undefined : next
}

function withoutObservedAt(args: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--observed-at') {
      index += 1
      continue
    }
    if (!token.startsWith('--observed-at=')) kept.push(token)
  }
  return kept
}

const digestSha256 = (canonicalJson: string): string =>
  createHash('sha256').update(canonicalJson, 'utf8').digest('hex')

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const rawObservedAt = flagValue(argv, '--observed-at')
  const observedAt = rawObservedAt ? new Date(rawObservedAt) : null
  if (!observedAt || Number.isNaN(observedAt.getTime())) {
    console.error(`--observed-at must be a valid ISO-8601 value\nusage: ${USAGE}`)
    process.exit(2)
  }

  const result = await runOperatorCommand(
    { name: COMMAND_NAME, scope: 'org', mutation: false, usage: USAGE },
    async (_context, args, io) => {
      const organizationId = args.organizationId
      // The harness already refuses a scope-'org' command without --org; this
      // narrows the type without a cast and keeps the failure explicit.
      if (!organizationId) throw new Error('--org <id> is required')
      const scan = await readInboxHandlingCutoverScan(getDb(), {
        organizationId,
        observedAt,
      })
      // The posture is asserted, not assumed: an evidence artifact produced
      // outside a read-only snapshot is not evidence.
      if (!scan.transaction.readOnly || scan.transaction.writeTransactionAssigned) {
        throw new Error('inbox cutover scan did not run read-only — refusing to emit')
      }
      const report = canonicalInboxHandlingCutoverReport({
        dataCellId: DATA_CELL_ID,
        organizationId,
        generatedAt: observedAt,
        relationships: scan.relationships,
        digestSha256,
      })
      io.out(
        canonicalizeRfc8785({
          version: EVIDENCE_VERSION,
          dataCellId: DATA_CELL_ID,
          organizationId,
          observedAt: observedAt.toISOString(),
          transaction: scan.transaction,
          reportSha256: report.sha256,
          report: report.payload,
          parity: scan.parity,
          outcomeTallies: scan.outcomeTallies,
          responseTargets: scan.responseTargets,
        }),
      )
    },
    withoutObservedAt(argv),
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND_NAME} failed`, error)
  process.exit(1)
})
