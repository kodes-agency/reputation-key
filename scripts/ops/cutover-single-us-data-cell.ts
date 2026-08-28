// ADR-0057 report-first, bounded and resumable single-US beta cutover.
//
// Report (default, read-only):
//   pnpm ops:cutover-single-us-data-cell --operator <id>
//
// Apply exactly one reviewed step/batch:
//   export RAILWAY_PROJECT_ID=<opaque-id> RAILWAY_ENVIRONMENT_ID=<opaque-id>
//   pnpm ops:cutover-single-us-data-cell <report-sha256> [evidence-output] \
//     --operator <id> --ticket <ref> --reason <text> --batch-size <n> \
//     --apply --yes ops:cutover-single-us-data-cell

import { writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { getDb } from '../../src/shared/db'
import {
  applySingleUsDataCellCutoverBatch,
  createSingleUsDataCellCutoverReport,
  readCompletedSingleUsDataCellCutover,
} from '../../src/shared/db/single-us-data-cell-cutover'
import {
  canonicalDataCellCutoverEvidence,
  createDataCellCutoverEvidence,
  dataCellCutoverEvidenceSha256,
} from '../../src/shared/release/data-cell-cutover-evidence'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:cutover-single-us-data-cell'
const USAGE =
  `pnpm ${COMMAND} [<expected-report-sha256> [docs/release-evidence/<file>.json]] ` +
  `--operator <id> [--ticket <ref> --reason <text> --batch-size <n> ` +
  `--apply --yes ${COMMAND}]`

function evidenceOutputPath(raw: string): string {
  const root = resolve(process.cwd(), 'docs/release-evidence')
  const target = resolve(process.cwd(), raw)
  const child = relative(root, target)
  if (
    child === '' ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    !target.endsWith('.json')
  ) {
    throw new Error(
      'cutover evidence output must be a .json file under docs/release-evidence',
    )
  }
  return target
}

function requiredRailwayTargetId(name: 'RAILWAY_PROJECT_ID' | 'RAILWAY_ENVIRONMENT_ID') {
  const value = process.env[name]?.trim()
  if (!value || value.length > 255) {
    throw new Error(`${name} must contain the exact Railway target ID`)
  }
  return value
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      batchSize: { default: 100, max: 500 },
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const db = getDb()
      const report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
      io.out(JSON.stringify({ command: COMMAND, mode: 'report', report }, null, 2))
      if (ctx.dryRun) {
        if (args.positionals.length > 0) throw new Error(`usage: ${USAGE}`)
        return
      }
      const [expectedReportDigestSha256, rawEvidencePath] = args.positionals
      if (!expectedReportDigestSha256 || args.positionals.length > 2) {
        throw new Error(`usage: ${USAGE}`)
      }
      const targetProjectId = requiredRailwayTargetId('RAILWAY_PROJECT_ID')
      const targetEnvironmentId = requiredRailwayTargetId('RAILWAY_ENVIRONMENT_ID')
      const outcome = await applySingleUsDataCellCutoverBatch(db, {
        expectedReportDigestSha256,
        batchSize: ctx.batchSize!,
        operatorId: ctx.operatorId,
        changeTicket: ctx.ticket!,
        correlationId: ctx.correlationId,
        targetProjectId,
        targetEnvironmentId,
        now: new Date(),
      })
      io.out(JSON.stringify({ command: COMMAND, mode: 'apply', ...outcome }, null, 2))
      if (outcome.outcome === 'blocked') return 1
      if (rawEvidencePath) {
        const completed = await readCompletedSingleUsDataCellCutover(db)
        if (!completed) {
          throw new Error('cutover evidence is available only after verified completion')
        }
        const evidence = createDataCellCutoverEvidence({
          capturedAt: completed.verifiedAt,
          ...completed,
        })
        const canonical = canonicalDataCellCutoverEvidence(evidence)
        const output = evidenceOutputPath(rawEvidencePath)
        writeFileSync(output, canonical, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        io.out(
          JSON.stringify({
            command: COMMAND,
            evidence: rawEvidencePath,
            evidenceSha256: dataCellCutoverEvidenceSha256(canonical),
          }),
        )
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
