import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPABILITY_POLICY_VERSION } from '../../src/shared/auth/beta-capabilities'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  DATA_CELL_IDS,
} from '../../src/shared/domain/data-cell-catalogue'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTION_MANIFEST_VERSION,
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotionManifestSha256,
  type PromotedImageRole,
  type PromotionManifest,
} from '../../src/shared/release/promotion-manifest'

type ImageEvidence = PromotionManifest['images'][PromotedImageRole] &
  Readonly<{ role: PromotedImageRole }>

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

function sha256File(path: string): string {
  return promotionManifestSha256(readFileSync(path))
}

function sourceTreeDigest(paths: readonly string[]): string {
  const entries = paths
    .flatMap((path) => {
      const absolute = resolve(path)
      return readdirSync(absolute, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = join(entry.parentPath, entry.name)
          return {
            path: filePath.slice(process.cwd().length + 1),
            sha256: sha256File(filePath),
          }
        })
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return promotionManifestSha256(`${JSON.stringify(entries)}\n`)
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
  const images = Object.fromEntries(
    PROMOTED_IMAGE_ROLES.map((role) => {
      const evidence = parseImageEvidence(resolve(input.imagesDir, `${role}.json`), role)
      const { role: _role, ...image } = evidence
      return [role, image]
    }),
  ) as PromotionManifest['images']

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
    contract: {
      lockfileSha256: sha256File(resolve('pnpm-lock.yaml')),
      iacSha256: sourceTreeDigest(['.railway']),
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
    cells: [...DATA_CELL_IDS],
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
