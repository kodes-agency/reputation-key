// LEG-01 — produce the typed `release.legalRevisionSet` artifact Gate F binds.
//
// Usage:
//   pnpm release:create-legal-revision-set -- \
//     --release-sha=<40 hex> --release-manifest-sha256=<64 hex> \
//     --project-id=<railway project> --environment-id=<railway environment> \
//     --out=<path> [--cell=us] [--environment=cell-us]
//
// The rule this tool encodes is the program's hardest one: **a producer that
// cannot reach a real approval must FAIL, not emit a plausible artifact.**
// While any counsel-owned document in
// `docs/legal/legal-document-registry.json` is a draft, the tool refuses,
// names the blocking ids, and writes NOTHING — which is the state of the
// repository today, so running it proves the fail-closed path rather than
// producing evidence.
//
// Nothing here can manufacture an approval: every field of every entry is
// copied from a registry row, and the finished bytes are re-parsed through
// `parseLegalRevisionSetEvidence` before they are written. A set the gate
// would reject is never emitted.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  legalPublicationBlockers,
  validateLegalDocumentRegistry,
} from '../../src/shared/governance/legal-approval-authority'
import {
  LEGAL_DOCUMENT_REGISTRY_PATH,
  canonicalLegalDocumentRegistry,
  legalDocumentSha256,
  parseLegalDocumentRegistry,
  type LegalDocumentRegistry,
} from '../../src/shared/governance/legal-document-registry'
import {
  IN_PRODUCT_NOTICES,
  type InProductNotice,
} from '../../src/shared/governance/legal-link-targets'
import {
  LEGAL_REVISION_SET_EVIDENCE_VERSION,
  canonicalLegalRevisionSetEvidence,
  parseLegalRevisionSetEvidence,
  requiredLegalRevisionSetDocumentIds,
  type LegalRevisionSetContext,
  type LegalRevisionSetEvidence,
} from '../../src/shared/release/legal-revision-set-evidence'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'

const ROOT = resolve(import.meta.dirname, '../..')

const RELEASE_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u

export type CreateLegalRevisionSetDependencies = Readonly<{
  /** Reads a repository-relative path; throws when it is absent. */
  readFile: (path: string) => Uint8Array
  writeFile: (path: string, content: string) => void
  writeOut: (line: string) => void
  writeError: (line: string) => void
  /** `null` means "read and parse the shipped registry artifact". */
  registry: LegalDocumentRegistry | null
  inProductNotices: readonly InProductNotice[]
  now: Date
}>

function defaultDependencies(): CreateLegalRevisionSetDependencies {
  return {
    readFile: (path) => readFileSync(resolve(ROOT, path)),
    writeFile: (path, content) => {
      writeFileSync(path, content)
    },
    writeOut: (line) => {
      process.stdout.write(`${line}\n`)
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`)
    },
    registry: null,
    inProductNotices: IN_PRODUCT_NOTICES,
    now: new Date(),
  }
}

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

/**
 * Same shape as `scripts/release/validate-bundle.ts`: the tool has exactly
 * one output, and a path assembled from parent segments cannot redirect it.
 */
function isNormalizedOutputPath(value: string): boolean {
  if (value.includes('\\')) return false
  const segments = value.split('/')
  return !segments.includes('..') && !segments.includes('.')
}

type Usage = Readonly<{ code: 2; message: string }>

type Invocation = Readonly<{
  releaseSha: string
  releaseManifestSha256: string
  projectId: string
  environmentId: string
  cell: string
  environment: string
  out: string
}>

function readInvocation(args: readonly string[]): Invocation | Usage {
  const required = {
    '--release-sha': flagValue(args, '--release-sha'),
    '--release-manifest-sha256': flagValue(args, '--release-manifest-sha256'),
    '--project-id': flagValue(args, '--project-id'),
    '--environment-id': flagValue(args, '--environment-id'),
    '--out': flagValue(args, '--out'),
  }
  for (const [name, value] of Object.entries(required)) {
    if (value === undefined || value.trim() === '') {
      return { code: 2, message: `${name} is required` }
    }
  }
  const releaseSha = required['--release-sha'] ?? ''
  const releaseManifestSha256 = required['--release-manifest-sha256'] ?? ''
  const out = required['--out'] ?? ''
  if (!RELEASE_SHA.test(releaseSha)) {
    return { code: 2, message: '--release-sha must be a 40-character lowercase revision' }
  }
  if (!SHA256.test(releaseManifestSha256)) {
    return { code: 2, message: '--release-manifest-sha256 must be a lowercase sha256' }
  }
  if (!isNormalizedOutputPath(out)) {
    return {
      code: 2,
      message: '--out: output path must be a normalized path without parent segments',
    }
  }
  const cell = flagValue(args, '--cell') ?? 'us'
  const environment = flagValue(args, '--environment') ?? 'cell-us'
  if (cell !== 'us' || environment !== 'cell-us') {
    return { code: 2, message: 'beta legal revision set must bind cell-us only' }
  }
  return {
    releaseSha,
    releaseManifestSha256,
    projectId: required['--project-id'] ?? '',
    environmentId: required['--environment-id'] ?? '',
    cell,
    environment,
    out,
  }
}

function buildRevisionSet(
  invocation: Invocation,
  context: LegalRevisionSetContext,
  now: Date,
): LegalRevisionSetEvidence | Readonly<{ errors: readonly string[] }> {
  const byId = new Map(context.registry.documents.map((row) => [row.id, row]))
  const missing: string[] = []
  const documents = requiredLegalRevisionSetDocumentIds(context).flatMap((id) => {
    const row = byId.get(id)
    if (
      row === undefined ||
      row.effectiveFrom === null ||
      row.reviewDueOn === null ||
      row.expiresOn === null ||
      row.approvedAt === null ||
      row.approver === null ||
      row.approvalEvidenceRef === null
    ) {
      missing.push(id)
      return []
    }
    // Copied field by field from the registry row. Nothing is defaulted,
    // inferred, or synthesized: an unrecorded approval stays unrecorded.
    return [
      {
        id: row.id,
        kind: row.kind,
        title: row.title,
        path: row.path,
        version: row.version,
        status: row.status,
        sha256: row.sha256,
        effectiveFrom: row.effectiveFrom,
        reviewDueOn: row.reviewDueOn,
        expiresOn: row.expiresOn,
        approvedAt: row.approvedAt,
        approver: row.approver,
        approvalEvidenceRef: row.approvalEvidenceRef,
      },
    ]
  })
  if (missing.length > 0) {
    return {
      errors: missing.map(
        (id) => `refusing to emit: ${id} has no complete approval record in the registry`,
      ),
    }
  }
  return {
    version: LEGAL_REVISION_SET_EVIDENCE_VERSION,
    evidenceKind: 'legal-revision-set',
    candidate: {
      releaseSha: invocation.releaseSha,
      releaseManifestSha256: invocation.releaseManifestSha256,
      cell: 'us',
      environment: 'cell-us',
      deploymentProfile: 'production',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
      projectId: invocation.projectId,
      environmentId: invocation.environmentId,
      appOrigin: 'https://us.reputationkey.app',
    },
    cell: invocation.cell,
    environment: invocation.environment,
    capturedAt: now.toISOString(),
    registry: {
      path: LEGAL_DOCUMENT_REGISTRY_PATH,
      sha256: registryDigest(context.registry),
    },
    documents,
    outcome: 'passed',
    failures: [],
  }
}

/** One canonical encoding of the registry, owned by the governance module. */
function registryDigest(registry: LegalDocumentRegistry): string {
  return legalDocumentSha256(canonicalLegalDocumentRegistry(registry))
}

export function runCreateLegalRevisionSetCli(
  args: readonly string[],
  overrides: Partial<CreateLegalRevisionSetDependencies> = {},
): number {
  const dependencies = { ...defaultDependencies(), ...overrides }
  const fail = (code: 1 | 2, errors: readonly string[]): number => {
    for (const error of errors) dependencies.writeError(error)
    return code
  }

  const invocation = readInvocation(args)
  if ('code' in invocation) return fail(invocation.code, [invocation.message])

  let registry: LegalDocumentRegistry
  if (dependencies.registry !== null) {
    registry = dependencies.registry
  } else {
    let content: string
    try {
      content = new TextDecoder().decode(
        dependencies.readFile(LEGAL_DOCUMENT_REGISTRY_PATH),
      )
    } catch (error) {
      return fail(1, [
        `legal document registry cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      ])
    }
    const parsed = parseLegalDocumentRegistry(content)
    if (!parsed.ok) return fail(1, parsed.errors)
    registry = parsed.registry
  }

  // FIRST, and before anything that could produce bytes: refuse while any
  // counsel-owned document is unapproved. This is the branch that runs today.
  const blockers = legalPublicationBlockers(registry)
  if (blockers.length > 0) {
    return fail(1, [
      `refusing to emit: ${String(blockers.length)} legal documents are drafts (${blockers.join(', ')})`,
    ])
  }

  // In-product notices are not files under `docs/legal/`; their digest is
  // taken over the frozen copy object the product renders, and is checked by
  // `parseLegalRevisionSetEvidence` against the shipped pin. Only the
  // file-backed rows are digested against bytes here.
  const fileBacked = {
    ...registry,
    documents: registry.documents.filter(
      (document) => document.kind !== 'in_product_notice',
    ),
  }
  const validation = validateLegalDocumentRegistry({
    registry: fileBacked,
    readDocument: dependencies.readFile,
    now: dependencies.now,
  })
  if (!validation.ok) return fail(1, validation.errors)

  const context: LegalRevisionSetContext = {
    registry,
    inProductNotices: dependencies.inProductNotices,
  }
  const built = buildRevisionSet(invocation, context, dependencies.now)
  if ('errors' in built) return fail(1, built.errors)

  const content = canonicalLegalRevisionSetEvidence(built)
  // Emit only what the gate would accept. A producer whose output its own
  // validator rejects has fabricated something.
  const verified = parseLegalRevisionSetEvidence(content, context)
  if (!verified.ok) {
    return fail(
      1,
      verified.errors.map((error) => `refusing to emit: ${error}`),
    )
  }

  dependencies.writeFile(resolve(process.cwd(), invocation.out), content)
  dependencies.writeOut(
    JSON.stringify({
      path: invocation.out,
      sha256: verified.digest,
      documents: verified.evidence.documents.length,
    }),
  )
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runCreateLegalRevisionSetCli(process.argv.slice(2))
}
