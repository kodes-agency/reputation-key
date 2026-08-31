// BQC-8.8 — validate a reviewer-facing beta release evidence bundle.
//
// Usage:
//   pnpm release:validate-evidence -- --release-sha=<sha> [--manifest-sha256=<digest>]
//   pnpm release:validate-evidence -- --release-id=beta-rc-2026-08-08.1
//   pnpm release:validate-evidence -- --gate-f-index=<path> [--evidence-root=<path>]
//        [--approval-roles=<path>] [--legal-root=<path>]
//
// Every form is read-only. The release SHA form validates the promoted
// beta-local-1 manifest, checksum, approvals, and immutable index. The release
// id form retains validation for historical reviewer bundles. The Gate F form
// validates the final candidate-bound index and every referenced artifact under
// one explicit evidence root.
//
// Containment is NOT one property held uniformly by this CLI, so read the word
// where it is used rather than as a blanket guarantee. In THIS file:
//
//   * `--gate-f-index` and every artifact it references are resolved with
//     `realpathSync` and rejected unless the RESOLVED path sits under the
//     evidence root. That is the only symlink-resolved containment performed
//     here, and even it checks a resolved name — see `readEvidenceFile` for
//     which part of the rewritten-underneath-us race the descriptor read closes
//     and which part it does not.
//   * `--release-id` and `--release-sha` are confined by the patterns their
//     values must match: neither can express a path separator and neither can
//     be a `..` segment, so no accepted value addresses a directory outside the
//     evidence root (the id form also keeps a lexical `startsWith` backstop).
//     Nothing here resolves symlinks INSIDE the directory so addressed; for the
//     release SHA form, whatever containment applies below that point belongs
//     to `validatePromotedLocalEvidence`, not to this file.
//   * `--legal-root` resolves the root once and then confines each document
//     LEXICALLY, reading the unresolved candidate — so a symlink planted under
//     the legal root is followed out of it. Those paths come from the evidence
//     index rather than the operator, which makes it the weakest containment
//     claim in this file; see `gateFValidationOptions`.
//   * `--approval-roles` is resolved against the process cwd and read with no
//     containment check at all. It is operator-supplied and trusted as such.

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGateFEvidenceBundle } from '../../src/shared/release/gate-f-evidence'
import {
  GATE_F_APPROVAL_ROLE_KEYS_PATH,
  createGateFApprovalVerifier,
  parseGateFApprovalRoleKeys,
} from '../../src/shared/release/gate-f-approval-envelope'
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

// Stat the descriptor, not the path. A `statSync(path)` followed by a
// `readFileSync(path)` checks one inode and reads another if the path is
// swapped in between, so the regular-file guard that ran is not the guard the
// read obeyed. Opening once and validating the open descriptor makes the
// checked object and the object whose bytes are returned the same by
// construction.
//
// O_NONBLOCK is what keeps that safe. The `isFile()` guard can only run AFTER
// the open, and a plain `O_RDONLY` open of a FIFO blocks until a writer
// appears, so the very swap this guards against could otherwise hang the CLI
// where the old path-stat rejected it immediately. The guard is then what makes
// a non-blocking FIFO fail as the wrong file shape it is: without it the FIFO
// reads as zero bytes and the CLI reports a misleading schema or digest failure
// instead of naming the substituted path.
//
// O_NOFOLLOW constrains ONLY the final path component. It turns a leaf that was
// swapped for a symlink after the caller's `realpathSync` into a loud open
// failure instead of a silent redirect. It does NOT make the caller's
// containment check race-free: an intermediate directory replaced by a symlink
// between `realpathSync` and this open still resolves outside the evidence
// root. Closing that needs openat-style resolution against a held directory
// descriptor, which node:fs does not expose.
function readEvidenceFile(realPath: string, rejection: string): Buffer {
  const descriptor = openSync(
    realPath,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(rejection)
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

// The historical release-id bundle treats every evidence file as optional here
// and lets `validateReleaseBundle` report which required ones are missing. Ask
// the filesystem once for the bytes rather than asking whether the path exists
// and then reading it: the two-step form decides on one lookup and acts on
// another, and an absent file is exactly what a failed open already tells us.
// Only ENOENT is absence — every other errno is a real fault and still escapes.
function readOptionalFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * REL-01-T7/T8: the CLI supplies the two inputs Gate F fails closed without —
 * the TRACKED public-key role map and a repository-relative reader for the
 * legal documents. Neither is optional: a bundle validated without them would
 * be accepting approvals nobody can verify over documents nobody re-hashed.
 */
function gateFValidationOptions(
  approvalRolesArg: string | undefined,
  legalRootArg: string | undefined,
):
  | Readonly<{ ok: true; options: Parameters<typeof validateGateFEvidenceBundle>[2] }>
  | Readonly<{ ok: false; errors: readonly string[] }> {
  const rolesPath = resolve(
    process.cwd(),
    approvalRolesArg ?? GATE_F_APPROVAL_ROLE_KEYS_PATH,
  )
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(rolesPath, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      errors: [
        `Gate F approval role key map ${rolesPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
  const parsed = parseGateFApprovalRoleKeys(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((error) => `approval role keys: ${error}`),
    }
  }
  // `--legal-root` exists so a reviewer can validate a bundle against the
  // document set it was approved over. Its containment is WEAKER than
  // `--evidence-root`'s, and the difference is deliberate to state rather than
  // to imply: the root is resolved once here, but each document path is then
  // only checked lexically and read UNRESOLVED, so a symlink planted under the
  // legal root is followed out of it. Those paths come from the evidence index,
  // not the operator. Closing it means the same `realpathSync` + descriptor
  // read `readEvidenceFile` performs; until that lands, do not read "contained"
  // on this reader as "symlink-resolved".
  const legalRoot = realpathSync(resolve(process.cwd(), legalRootArg ?? '.'))
  return {
    ok: true,
    options: {
      verifyApproval: createGateFApprovalVerifier(parsed.roleKeys),
      legalDocuments: {
        readDocument: (path: string) => {
          const candidate = resolve(legalRoot, path)
          if (!isContainedPath(legalRoot, candidate)) {
            throw new Error('legal document resolved outside the legal root')
          }
          return readFileSync(candidate)
        },
      },
    },
  }
}

function validateGateFIndex(
  indexArg: string,
  evidenceRootArg?: string,
  approvalRolesArg?: string,
  legalRootArg?: string,
): number {
  const options = gateFValidationOptions(approvalRolesArg, legalRootArg)
  if (!options.ok) {
    for (const error of options.errors) console.error(error)
    return 2
  }
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

    const result = validateGateFEvidenceBundle(
      readEvidenceFile(indexRealPath, 'Gate F index is not a regular file').toString(
        'utf8',
      ),
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
        return readEvidenceFile(realPath, 'reference is not a regular file')
      },
      options.options,
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

type ReleaseValidationArgs = Readonly<{
  releaseSha: string | undefined
  releaseId: string | undefined
  gateFIndex: string | undefined
  expectedManifestSha256: string | undefined
  evidenceRoot: string | undefined
  approvalRoles: string | undefined
  legalRoot: string | undefined
}>

function readReleaseValidationArgs(args: readonly string[]): ReleaseValidationArgs {
  return {
    releaseSha: argValue(args, '--release-sha'),
    releaseId: argValue(args, '--release-id'),
    gateFIndex: argValue(args, '--gate-f-index'),
    expectedManifestSha256: argValue(args, '--manifest-sha256'),
    evidenceRoot: argValue(args, '--evidence-root'),
    approvalRoles: argValue(args, '--approval-roles'),
    legalRoot: argValue(args, '--legal-root'),
  }
}

/** Exactly one mode may be selected, and each modifier belongs to one mode. */
function hasWellFormedModeSelection(parsed: ReleaseValidationArgs): boolean {
  const selectedModes = [parsed.releaseSha, parsed.releaseId, parsed.gateFIndex].filter(
    (value) => value != null,
  )
  if (selectedModes.length !== 1) return false
  if (parsed.expectedManifestSha256 != null && parsed.releaseSha == null) return false
  const gateFModifiers = [parsed.evidenceRoot, parsed.approvalRoles, parsed.legalRoot]
  return parsed.gateFIndex != null || gateFModifiers.every((value) => value == null)
}

function validatePromotedLocalRelease(
  releaseSha: string,
  expectedManifestSha256: string | undefined,
): number {
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

function validateHistoricalReviewerBundle(releaseId: string | undefined): number {
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
  for (const path of [...BETA_RELEASE_EVIDENCE_FILES, 'scale-dataset.json']) {
    const contents = readOptionalFile(resolve(bundleDir, path))
    if (contents !== undefined) files.set(path, contents)
  }

  const result = validateReleaseBundle(files)
  if (!result.ok) {
    console.error(`BQC-8.8 release bundle ${releaseId} is invalid:`)
    for (const error of result.errors) console.error(`  - ${error}`)
    return 1
  }

  console.log(`BQC-8.8 release bundle ${releaseId}: valid`)
  return 0
}

export function runReleaseValidationCli(args: readonly string[]): number {
  const parsed = readReleaseValidationArgs(args)
  if (!hasWellFormedModeSelection(parsed)) {
    console.error(
      'Usage: choose exactly one of --release-sha=<sha>, --release-id=<id>, or --gate-f-index=<path>',
    )
    return 2
  }
  if (parsed.gateFIndex) {
    return validateGateFIndex(
      parsed.gateFIndex,
      parsed.evidenceRoot,
      parsed.approvalRoles,
      parsed.legalRoot,
    )
  }
  if (parsed.releaseSha) {
    return validatePromotedLocalRelease(parsed.releaseSha, parsed.expectedManifestSha256)
  }
  return validateHistoricalReviewerBundle(parsed.releaseId)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runReleaseValidationCli(process.argv.slice(2))
}
