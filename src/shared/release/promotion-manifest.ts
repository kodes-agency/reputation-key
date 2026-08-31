import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import {
  BETA_DEPLOYMENT_DATA_CELL_IDS,
  DATA_CELL_CATALOGUE_POLICY_VERSION,
} from '#/shared/domain/data-cell-catalogue'
import { releaseBuildToolchainSchema } from './release-build-toolchain'

export const PROMOTION_MANIFEST_VERSION = 'repkey-promotion-manifest-4' as const
export const TRUSTED_RELEASE_REPOSITORY = 'kodes-agency/reputation-key' as const
export const TRUSTED_RELEASE_WORKFLOW_IDENTITY =
  `https://github.com/${TRUSTED_RELEASE_REPOSITORY}/.github/workflows/release-images.yml@refs/heads/main` as const

export const PROMOTED_IMAGE_ROLES = [
  'web',
  'googleProviderRedis',
  'worker',
  'googleExecutionAdmission',
  'googleEgressGateway',
  'aiExecutionAdmission',
  'aiEgressGateway',
  'googleImportCompatibility',
] as const
export type PromotedImageRole = (typeof PROMOTED_IMAGE_ROLES)[number]

/**
 * A signed release may use only the repositories owned by this workflow.
 * Registry syntax validation alone would let a well-formed manifest redirect
 * one role to unrelated bytes in another allowed registry namespace.
 */
export const PROMOTED_IMAGE_REPOSITORIES = Object.freeze({
  web: 'ghcr.io/kodes-agency/repkey-web',
  googleProviderRedis: 'ghcr.io/kodes-agency/repkey-google-provider-redis',
  worker: 'ghcr.io/kodes-agency/repkey-worker',
  googleExecutionAdmission: 'ghcr.io/kodes-agency/repkey-google-execution-admission',
  googleEgressGateway: 'ghcr.io/kodes-agency/repkey-google-egress-gateway',
  aiExecutionAdmission: 'ghcr.io/kodes-agency/repkey-ai-execution-admission',
  aiEgressGateway: 'ghcr.io/kodes-agency/repkey-ai-egress-gateway',
  googleImportCompatibility: 'ghcr.io/kodes-agency/repkey-google-import-compatibility',
} as const satisfies Readonly<Record<PromotedImageRole, string>>)

export const RAILWAY_SERVICE_IMAGE_ROLES = Object.freeze({
  'google-provider-redis': 'googleProviderRedis',
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
        repository: z.literal(TRUSTED_RELEASE_REPOSITORY),
        ref: z.literal('refs/heads/main'),
      })
      .strict(),
    ci: z
      .object({
        workflowIdentity: z.literal(TRUSTED_RELEASE_WORKFLOW_IDENTITY),
        runId: z.string().regex(/^[1-9][0-9]*$/),
        runAttempt: z.literal(1),
      })
      .strict(),
    build: releaseBuildToolchainSchema,
    contract: z
      .object({
        lockfileSha256: sha256,
        iacSha256: sha256,
        releaseControllerSha256: sha256,
        migrationHead: z.string().min(1).max(128),
        capabilityPolicyVersion: z.string().min(1).max(128),
        dataCellCataloguePolicyVersion: z.literal(DATA_CELL_CATALOGUE_POLICY_VERSION),
        betaEvidenceManifestSha256: sha256,
        testEvidenceSha256: sha256,
        providerApprovalEvidenceSha256: sha256,
        sbomIndexSha256: sha256,
        vulnerabilityIndexSha256: sha256,
      })
      .strict(),
    cells: z.tuple([z.literal(BETA_DEPLOYMENT_DATA_CELL_IDS[0])]),
    images: z.object(imageSchemas).strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const role of PROMOTED_IMAGE_ROLES) {
      if (manifest.images[role].repository !== PROMOTED_IMAGE_REPOSITORIES[role]) {
        context.addIssue({
          code: 'custom',
          path: ['images', role, 'repository'],
          message: `image repository must be ${PROMOTED_IMAGE_REPOSITORIES[role]}`,
        })
      }
      if (manifest.images[role].sourceRevision !== manifest.releaseSha) {
        context.addIssue({
          code: 'custom',
          path: ['images', role, 'sourceRevision'],
          message: 'image source revision must equal release SHA',
        })
      }
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
  }>,
): readonly string[] {
  return Object.freeze([
    'verify-blob',
    '--bundle',
    input.bundlePath,
    '--certificate-identity',
    TRUSTED_RELEASE_WORKFLOW_IDENTITY,
    '--certificate-oidc-issuer',
    'https://token.actions.githubusercontent.com',
    input.manifestPath,
  ])
}
