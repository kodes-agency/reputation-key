// BQC-8.8 — validate a reviewer-facing beta release evidence bundle.
//
// Usage:
//   pnpm release:validate-evidence -- --release-sha=<sha> [--manifest-sha256=<digest>]
//   pnpm release:validate-evidence -- --release-id=beta-rc-2026-08-08.1
//
// Both formats are read-only and path-contained. The release SHA form validates
// the promoted beta-local-1 manifest, checksum, approvals, and immutable index.
// The release id form retains validation for historical reviewer bundles.

import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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

export function runReleaseValidationCli(args: readonly string[]): number {
  const releaseSha = argValue(args, '--release-sha')
  const expectedManifestSha256 = argValue(args, '--manifest-sha256')
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

  const releaseId = argValue(args, '--release-id')
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
