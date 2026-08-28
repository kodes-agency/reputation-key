// BQC-8.8 — validate a reviewer-facing beta release evidence bundle.
//
// Usage:
//   pnpm release:validate-evidence -- --release-sha=<sha> [--manifest-sha256=<digest>]
//   pnpm release:validate-evidence -- --release-id=beta-rc-2026-08-08.1
//   pnpm release:validate-evidence -- --gate-f-index=<path> [--evidence-root=<path>]
//
// Both formats are read-only and path-contained. The release SHA form validates
// the promoted beta-local-1 manifest, checksum, approvals, and immutable index.
// The release id form retains validation for historical reviewer bundles. The
// Gate F form validates the final candidate-bound index and every referenced
// artifact under one explicit evidence root.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGateFEvidenceBundle } from '../../src/shared/release/gate-f-evidence'
import { validatePromotedLocalEvidence } from '../../src/shared/testing/beta-local-evidence'
import {
  BETA_RELEASE_EVIDENCE_FILES,
  validateReleaseBundle,
} from '../../src/shared/testing/release-bundle'

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40,64}$/
const MANIFEST_DIGEST_PATTERN = /^[0-9a-f]{64}$/
const EVIDENCE_ROOT = resolve(process.cwd(), 'docs/release-evidence/beta')

function argValue(args: readonly string[], flag: string): string | undefined {
  const arg = args.find((value) => value.startsWith(`${flag}=`))
  return arg?.slice(flag.length + 1)
}

function isContainedPath(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot !== '' &&
    fromRoot !== '..' &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  )
}

function validateGateFIndex(indexArg: string, evidenceRootArg?: string): number {
  try {
    const indexPath = resolve(process.cwd(), indexArg)
    const evidenceRootPath = resolve(process.cwd(), evidenceRootArg ?? dirname(indexPath))
    const evidenceRoot = realpathSync(evidenceRootPath)
    if (!statSync(evidenceRoot).isDirectory()) {
      console.error('Gate F evidence root is not a directory')
      return 2
    }
    const indexRealPath = realpathSync(indexPath)
    if (!isContainedPath(evidenceRoot, indexRealPath)) {
      console.error('Gate F index resolved outside the evidence root')
      return 2
    }
    if (!statSync(indexRealPath).isFile()) {
      console.error('Gate F index is not a regular file')
      return 2
    }

    const result = validateGateFEvidenceBundle(
      readFileSync(indexRealPath, 'utf8'),
      (path) => {
        const candidatePath = resolve(evidenceRoot, path)
        if (!isContainedPath(evidenceRoot, candidatePath)) {
          throw new Error('reference resolved outside the evidence root')
        }
        const realPath = realpathSync(candidatePath)
        if (!isContainedPath(evidenceRoot, realPath)) {
          throw new Error(
            'reference resolves through a symlink outside the evidence root',
          )
        }
        if (!statSync(realPath).isFile()) {
          throw new Error('reference is not a regular file')
        }
        return readFileSync(realPath)
      },
    )
    if (!result.ok) {
      console.error(`Gate F evidence index ${indexArg} is invalid:`)
      for (const error of result.errors) console.error(`  - ${error}`)
      return 1
    }
    console.log(`Gate F evidence index ${indexArg}/${result.digest}: valid`)
    return 0
  } catch (error) {
    console.error(
      `Gate F evidence index could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 2
  }
}

export function runReleaseValidationCli(args: readonly string[]): number {
  const releaseSha = argValue(args, '--release-sha')
  const releaseId = argValue(args, '--release-id')
  const gateFIndex = argValue(args, '--gate-f-index')
  const expectedManifestSha256 = argValue(args, '--manifest-sha256')
  const evidenceRoot = argValue(args, '--evidence-root')
  const selectedModes = [releaseSha, releaseId, gateFIndex].filter(
    (value) => value != null,
  )
  if (
    selectedModes.length !== 1 ||
    (expectedManifestSha256 != null && releaseSha == null) ||
    (evidenceRoot != null && gateFIndex == null)
  ) {
    console.error(
      'Usage: choose exactly one of --release-sha=<sha>, --release-id=<id>, or --gate-f-index=<path>',
    )
    return 2
  }
  if (gateFIndex) return validateGateFIndex(gateFIndex, evidenceRoot)

  if (releaseSha) {
    if (
      !RELEASE_SHA_PATTERN.test(releaseSha) ||
      (expectedManifestSha256 != null &&
        !MANIFEST_DIGEST_PATTERN.test(expectedManifestSha256))
    ) {
      console.error(
        'Usage: --release-sha=<lowercase hex revision> [--manifest-sha256=<lowercase sha256>]',
      )
      return 2
    }
    const result = validatePromotedLocalEvidence({
      releaseDir: resolve(EVIDENCE_ROOT, 'local', releaseSha),
      expectedManifestSha256,
    })
    if (!result.ok) {
      console.error(`beta-local-1 evidence ${releaseSha} is invalid:`)
      for (const error of result.errors) console.error(`  - ${error}`)
      return 1
    }
    console.log(`beta-local-1 evidence ${releaseSha}/${result.manifestSha256}: valid`)
    return 0
  }

  if (!releaseId || !RELEASE_ID_PATTERN.test(releaseId)) {
    console.error(
      'Usage: --release-sha=<sha> or --release-id=<letters, numbers, dot, underscore, or hyphen>',
    )
    return 2
  }

  const bundleDir = resolve(EVIDENCE_ROOT, releaseId)
  if (!bundleDir.startsWith(`${EVIDENCE_ROOT}${sep}`)) {
    console.error('release id resolved outside the evidence root')
    return 2
  }

  const files = new Map<string, string>()
  for (const path of BETA_RELEASE_EVIDENCE_FILES) {
    const filePath = resolve(bundleDir, path)
    if (existsSync(filePath)) files.set(path, readFileSync(filePath, 'utf8'))
  }
  const datasetPath = resolve(bundleDir, 'scale-dataset.json')
  if (existsSync(datasetPath))
    files.set('scale-dataset.json', readFileSync(datasetPath, 'utf8'))

  const result = validateReleaseBundle(files)
  if (!result.ok) {
    console.error(`BQC-8.8 release bundle ${releaseId} is invalid:`)
    for (const error of result.errors) console.error(`  - ${error}`)
    return 1
  }

  console.log(`BQC-8.8 release bundle ${releaseId}: valid`)
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runReleaseValidationCli(process.argv.slice(2))
}
