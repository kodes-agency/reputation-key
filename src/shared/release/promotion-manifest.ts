import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { DATA_CELL_IDS } from '#/shared/domain/data-cell-catalogue'

export const PROMOTION_MANIFEST_VERSION = 'repkey-promotion-manifest-1' as const

export const PROMOTED_IMAGE_ROLES = [
  'web',
  'worker',
  'googleExecutionAdmission',
  'googleEgressGateway',
  'aiExecutionAdmission',
  'aiEgressGateway',
  'googleImportCompatibility',
] as const
export type PromotedImageRole = (typeof PROMOTED_IMAGE_ROLES)[number]

export const RAILWAY_SERVICE_IMAGE_ROLES = Object.freeze({
  web: 'web',
  worker: 'worker',
  'google-execution-admission': 'googleExecutionAdmission',
  'google-egress-gateway': 'googleEgressGateway',
  'ai-execution-admission': 'aiExecutionAdmission',
  'ai-egress-gateway': 'aiEgressGateway',
} as const satisfies Readonly<Record<string, PromotedImageRole>>)

export type RailwayApplicationService = keyof typeof RAILWAY_SERVICE_IMAGE_ROLES

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const imageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const sourceRevision = z.string().regex(/^[0-9a-f]{40}$/)
const registryRepository = z
  .string()
  .min(3)
  .max(255)
  .regex(
    /^(?:ghcr\.io|registry\.gitlab\.com|quay\.io|[a-z0-9.-]+\.docker\.io)\/[a-z0-9._/-]+$/,
  )

const promotedImageSchema = z
  .object({
    repository: registryRepository,
    digest: imageDigest,
    sourceRevision,
    sbomSha256: sha256,
    provenanceSha256: sha256,
    signatureBundleSha256: sha256,
    vulnerabilityReportSha256: sha256,
  })
  .strict()

const imageSchemas = Object.fromEntries(
  PROMOTED_IMAGE_ROLES.map((role) => [role, promotedImageSchema]),
) as Record<PromotedImageRole, typeof promotedImageSchema>

const promotionManifestSchema = z
  .object({
    version: z.literal(PROMOTION_MANIFEST_VERSION),
    releaseSha: sourceRevision,
    createdAt: z.iso.datetime({ offset: false }),
    source: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        ref: z.literal('refs/heads/main'),
      })
      .strict(),
    ci: z
      .object({
        workflowIdentity: z
          .string()
          .regex(
            /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9_.-]+@refs\/heads\/main$/,
          ),
        runId: z.string().regex(/^[1-9][0-9]*$/),
        runAttempt: z.number().int().min(1),
      })
      .strict(),
    contract: z
      .object({
        lockfileSha256: sha256,
        iacSha256: sha256,
        migrationHead: z.string().min(1).max(128),
        capabilityPolicyVersion: z.string().min(1).max(128),
        dataCellCataloguePolicyVersion: z.number().int().min(1),
        betaEvidenceManifestSha256: sha256,
        testEvidenceSha256: sha256,
        providerApprovalEvidenceSha256: sha256,
        sbomIndexSha256: sha256,
        vulnerabilityIndexSha256: sha256,
      })
      .strict(),
    cells: z.tuple([
      z.literal(DATA_CELL_IDS[0]),
      z.literal(DATA_CELL_IDS[1]),
      z.literal(DATA_CELL_IDS[2]),
    ]),
    images: z.object(imageSchemas).strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const role of PROMOTED_IMAGE_ROLES) {
      if (manifest.images[role].sourceRevision !== manifest.releaseSha) {
        context.addIssue({
          code: 'custom',
          path: ['images', role, 'sourceRevision'],
          message: 'image source revision must equal release SHA',
        })
      }
    }
    const expectedIdentity =
      `https://github.com/${manifest.source.repository}/.github/workflows/` as const
    if (!manifest.ci.workflowIdentity.startsWith(expectedIdentity)) {
      context.addIssue({
        code: 'custom',
        path: ['ci', 'workflowIdentity'],
        message: 'workflow identity must belong to the source repository',
      })
    }
  })

export type PromotionManifest = z.infer<typeof promotionManifestSchema>

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedJson(record[key] ?? null)]),
    )
  }
  return value
}

export function canonicalPromotionManifest(value: PromotionManifest): string {
  return `${JSON.stringify(sortedJson(value as JsonValue))}\n`
}

export function promotionManifestSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export type PromotionManifestParseResult =
  | Readonly<{ ok: true; manifest: PromotionManifest; digest: string }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parsePromotionManifest(content: string): PromotionManifestParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['promotion manifest is not valid JSON'] }
  }
  const parsed = promotionManifestSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`,
      ),
    }
  }
  const canonical = canonicalPromotionManifest(parsed.data)
  if (content !== canonical) {
    return {
      ok: false,
      errors: ['promotion manifest must use canonical JSON encoding'],
    }
  }
  return {
    ok: true,
    manifest: Object.freeze(parsed.data),
    digest: promotionManifestSha256(canonical),
  }
}

export function promotedImageReference(
  manifest: PromotionManifest,
  service: RailwayApplicationService,
): string {
  const image = manifest.images[RAILWAY_SERVICE_IMAGE_ROLES[service]]
  return `${image.repository}@${image.digest}`
}

export function sigstoreManifestVerificationArgs(
  input: Readonly<{
    manifestPath: string
    bundlePath: string
    workflowIdentity: string
  }>,
): readonly string[] {
  return Object.freeze([
    'verify-blob',
    '--bundle',
    input.bundlePath,
    '--certificate-identity',
    input.workflowIdentity,
    '--certificate-oidc-issuer',
    'https://token.actions.githubusercontent.com',
    input.manifestPath,
  ])
}
