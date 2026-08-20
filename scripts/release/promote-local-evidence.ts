import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promoteLocalEvidence } from '../../src/shared/testing/beta-local-evidence'

const DEFAULT_EVIDENCE_ROOT = 'docs/release-evidence/beta/local'

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  const value = args.find((arg) => arg.startsWith(prefix))
  return value?.slice(prefix.length)
}

export function runPromoteLocalEvidenceCli(args: readonly string[]): number {
  const manifestPath = flagValue(args, '--manifest')
  const approvalsDir = flagValue(args, '--approvals-dir')
  if (!manifestPath || !approvalsDir) {
    console.error(
      'Usage: release:promote-local-evidence -- --manifest=<manifest.json> --approvals-dir=<directory> [--gate-evidence-root=<directory>] [--evidence-root=<directory>]',
    )
    return 2
  }
  try {
    const promoted = promoteLocalEvidence({
      manifestPath: resolve(manifestPath),
      approvalsDir: resolve(approvalsDir),
      gateEvidenceRoot: resolve(flagValue(args, '--gate-evidence-root') ?? process.cwd()),
      evidenceRoot: resolve(flagValue(args, '--evidence-root') ?? DEFAULT_EVIDENCE_ROOT),
    })
    console.log(`promoted local beta evidence: ${promoted.bundleDir}`)
    console.log(`local beta evidence index: ${promoted.indexPath}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPromoteLocalEvidenceCli(process.argv.slice(2))
}
