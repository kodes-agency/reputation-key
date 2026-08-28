import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  DATA_CELL_CATALOGUE_POLICY_VERSION,
} from '../../src/shared/domain/data-cell-catalogue'
import { railwayIacSourceDigest, sourceFileSha256 } from './iac-digest'
import { releaseControllerSourceDigest } from './release-authority-digest'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTION_MANIFEST_VERSION,
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotionManifestSha256,
  type PromotedImageRole,
  type PromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import {
  parseReleaseBuildToolchainObservation,
  type ReleaseBuildToolchainObservation,
} from '../../src/shared/release/release-build-toolchain'

type ImageEvidence = PromotionManifest['images'][PromotedImageRole] &
  Readonly<{ role: PromotedImageRole }>

type ImageBuildMetadata = Readonly<{
  toolchain: ReleaseBuildToolchainObservation
  sha256: string
}>

const IMAGE_EVIDENCE_ARTIFACTS = Object.freeze({
  sbomSha256: 'spdx.json',
  provenanceSha256: 'provenance.json',
  signatureBundleSha256: 'sigstore.json',
  vulnerabilityReportSha256: 'vulnerability.sarif',
} as const)

const SHA256 = /^[0-9a-f]{64}$/u

function flagValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = flagValue(args, name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredDigest(args: readonly string[], name: string): string {
  const value = requiredFlag(args, name)
  if (!SHA256.test(value)) throw new Error(`${name} must be a lowercase sha256`)
  return value
}

function migrationHead(): string {
  const journal = JSON.parse(
    readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8'),
  ) as Readonly<{ entries?: readonly Readonly<{ tag?: string }>[] }>
  const tag = journal.entries?.at(-1)?.tag
  if (!tag) throw new Error('Drizzle migration head is unavailable')
  return tag
}

function parseImageEvidence(path: string, role: PromotedImageRole): ImageEvidence {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`image evidence ${role} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (record.role !== role) throw new Error(`image evidence role mismatch: ${role}`)
  return record as ImageEvidence
}

function assertImageEvidenceArtifacts(
  imagesDir: string,
  role: PromotedImageRole,
  evidence: ImageEvidence,
): void {
  for (const [digestField, suffix] of Object.entries(IMAGE_EVIDENCE_ARTIFACTS)) {
    const field = digestField as keyof typeof IMAGE_EVIDENCE_ARTIFACTS
    const artifact = `${role}.${suffix}`
    const observed = sourceFileSha256(resolve(imagesDir, artifact))
    if (evidence[field] !== observed) {
      throw new Error(`image evidence ${role} ${field} does not match ${artifact}`)
    }
  }
}

function parseImageBuildMetadata(
  path: string,
  expected: Readonly<{
    role: PromotedImageRole
    sourceRevision: string
    workflow: string
    runId: string
    runAttempt: number
    image: string
  }>,
): ImageBuildMetadata {
  const content = readFileSync(path, 'utf8')
  const value = JSON.parse(content) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`image build metadata ${expected.role} must be an object`)
  }
  const record = value as Record<string, unknown>
  if (record.version !== 'repkey-image-provenance-2') {
    throw new Error(`image build metadata ${expected.role} version is invalid`)
  }
  for (const [field, wanted] of Object.entries(expected)) {
    if (record[field] !== wanted) {
      throw new Error(`image build metadata ${expected.role} ${field} mismatch`)
    }
  }
  return {
    toolchain: parseReleaseBuildToolchainObservation(record.toolchain),
    sha256: sourceFileSha256(path),
  }
}

export function createPromotionManifest(
  input: Readonly<{
    imagesDir: string
    betaEvidenceManifestSha256: string
    testEvidenceSha256: string
    providerApprovalEvidenceSha256: string
    releaseSha: string
    repository: string
    workflowIdentity: string
    runId: string
    runAttempt: number
    createdAt: string
  }>,
): PromotionManifest {
  const workflow = input.workflowIdentity.replace(/^https:\/\/github\.com\//u, '')
  const rows = PROMOTED_IMAGE_ROLES.map((role) => {
    const evidence = parseImageEvidence(resolve(input.imagesDir, `${role}.json`), role)
    assertImageEvidenceArtifacts(input.imagesDir, role, evidence)
    const { role: _role, ...image } = evidence
    const metadata = parseImageBuildMetadata(
      resolve(input.imagesDir, `${role}.release-metadata.json`),
      {
        role,
        sourceRevision: input.releaseSha,
        workflow,
        runId: input.runId,
        runAttempt: input.runAttempt,
        image: `${image.repository}@${image.digest}`,
      },
    )
    return { role, image, metadata }
  })
  const images = Object.fromEntries(
    rows.map(({ role, image }) => [role, image]),
  ) as PromotionManifest['images']
  const toolchain = rows[0]?.metadata.toolchain
  if (!toolchain) throw new Error('release build toolchain evidence is unavailable')
  const expectedToolchain = JSON.stringify(toolchain)
  for (const { role, metadata } of rows) {
    if (JSON.stringify(metadata.toolchain) !== expectedToolchain) {
      throw new Error(`image build metadata ${role} toolchain mismatch`)
    }
  }
  const imageMetadataIndex = Object.fromEntries(
    rows.map(({ role, metadata }) => [role, metadata.sha256]),
  )

  const sbomIndex = Object.fromEntries(
    PROMOTED_IMAGE_ROLES.map((role) => [role, images[role].sbomSha256]),
  )
  const vulnerabilityIndex = Object.fromEntries(
    PROMOTED_IMAGE_ROLES.map((role) => [role, images[role].vulnerabilityReportSha256]),
  )

  const candidate = {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha: input.releaseSha,
    createdAt: input.createdAt,
    source: { repository: input.repository, ref: 'refs/heads/main' },
    ci: {
      workflowIdentity: input.workflowIdentity,
      runId: input.runId,
      runAttempt: input.runAttempt,
    },
    build: {
      ...toolchain,
      imageMetadataIndexSha256: promotionManifestSha256(
        `${JSON.stringify(imageMetadataIndex)}\n`,
      ),
    },
    contract: {
      lockfileSha256: sourceFileSha256(resolve('pnpm-lock.yaml')),
      iacSha256: railwayIacSourceDigest(),
      releaseControllerSha256: releaseControllerSourceDigest(),
      migrationHead: migrationHead(),
      capabilityPolicyVersion: CAPABILITY_POLICY_VERSION,
      dataCellCataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
      betaEvidenceManifestSha256: input.betaEvidenceManifestSha256,
      testEvidenceSha256: input.testEvidenceSha256,
      providerApprovalEvidenceSha256: input.providerApprovalEvidenceSha256,
      sbomIndexSha256: promotionManifestSha256(`${JSON.stringify(sbomIndex)}\n`),
      vulnerabilityIndexSha256: promotionManifestSha256(
        `${JSON.stringify(vulnerabilityIndex)}\n`,
      ),
    },
    cells: [...BETA_DEPLOYMENT_DATA_CELL_IDS],
    images,
  }
  const parsed = parsePromotionManifest(
    canonicalPromotionManifest(candidate as PromotionManifest),
  )
  if (!parsed.ok) {
    throw new Error(
      `generated promotion manifest is invalid: ${parsed.errors.join('; ')}`,
    )
  }
  return parsed.manifest
}

export function runCreatePromotionManifestCli(args: readonly string[]): number {
  try {
    const output = resolve(requiredFlag(args, '--output'))
    const manifest = createPromotionManifest({
      imagesDir: resolve(requiredFlag(args, '--images-dir')),
      betaEvidenceManifestSha256: requiredDigest(args, '--beta-evidence-manifest-sha256'),
      testEvidenceSha256: requiredDigest(args, '--test-evidence-sha256'),
      providerApprovalEvidenceSha256: requiredDigest(
        args,
        '--provider-approval-evidence-sha256',
      ),
      releaseSha: process.env.GITHUB_SHA ?? '',
      repository: process.env.GITHUB_REPOSITORY ?? '',
      workflowIdentity: process.env.GITHUB_WORKFLOW_REF
        ? `https://github.com/${process.env.GITHUB_WORKFLOW_REF}`
        : '',
      runId: process.env.GITHUB_RUN_ID ?? '',
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? ''),
      createdAt: new Date().toISOString(),
    })
    const content = canonicalPromotionManifest(manifest)
    const digest = promotionManifestSha256(content)
    writeFileSync(output, content, { encoding: 'utf8', flag: 'wx' })
    writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    process.stdout.write(`${digest}\n`)
    return 0
  } catch (error) {
    process.stderr.write(
      `create promotion manifest failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runCreatePromotionManifestCli(process.argv.slice(2))
}
