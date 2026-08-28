import { z } from 'zod/v4'
import {
  GOOGLE_CONTENT_APPROVAL_TARGET_PHASES,
  GOOGLE_CONTENT_CAPABILITIES,
  GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  GOOGLE_CONTENT_ENVIRONMENT_PROFILES,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_CONTENT_POLICY_VERSION,
  GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION,
  GOOGLE_OAUTH_CONTRACT_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  type GoogleContentCapability,
} from './google-content-contract'
import type { GoogleContentRuntimeBinding } from './google-content-authority'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const imageDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const bindingSchema = z
  .object({
    capability: z.enum(GOOGLE_CONTENT_CAPABILITIES),
    targetPhase: z.enum(GOOGLE_CONTENT_APPROVAL_TARGET_PHASES),
    environmentProfile: z.enum(GOOGLE_CONTENT_ENVIRONMENT_PROFILES),
    releaseSha: z.string().min(1).max(128),
    evidenceManifestSha256: sha256,
    evidenceIndexSha256: sha256,
    deploymentAttestationSha256: sha256,
    adr0050Sha256: sha256,
    googleContentPolicyVersion: z.literal(GOOGLE_CONTENT_POLICY_VERSION),
    googleOAuthContractVersion: z.literal(GOOGLE_OAUTH_CONTRACT_VERSION),
    googleProjectAttestationSha256: sha256,
    googleOAuthClientIdSha256: sha256,
    googleRedirectUriSha256: sha256,
    providerOriginProfileSha256: sha256,
    runtimeIsolationProfileVersion: z
      .literal(GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION)
      .nullable(),
    runtimeIsolationProfileSha256: sha256.nullable(),
    railwayClosedBetaCohort: z
      .array(z.string().min(1).max(255))
      .min(1)
      .max(100)
      .nullable(),
    railwayClosedBetaCohortSha256: sha256.nullable(),
    railwayClosedBetaResidualRiskSha256: sha256.nullable(),
    performanceCatalogVersion: z.literal(GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION),
    routeCatalogueVersion: z.literal(GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION),
    capabilityPolicyVersion: z.literal(GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION),
    executionPolicyVersion: z.literal(GOOGLE_CONTENT_EXECUTION_POLICY_VERSION),
    migrationHead: z.string().min(1).max(128),
    imageDigests: z
      .object({
        web: imageDigest,
        worker: imageDigest,
        googleExecutionAdmission: imageDigest,
        googleEgressGateway: imageDigest,
        providerEphemeralRedis: imageDigest,
      })
      .strict(),
  })
  .strict()

const runtimeBindingsSchema = z
  .object({
    'property.import_gbp_v2': bindingSchema.optional(),
    'property.read_gbp_performance': bindingSchema.optional(),
    'property.connect_gbp': bindingSchema.optional(),
    'property.publish_reply': bindingSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const entries = Object.entries(value) as Array<
      [GoogleContentCapability, GoogleContentRuntimeBinding | undefined]
    >
    if (!entries.some(([, binding]) => binding !== undefined)) {
      context.addIssue({ code: 'custom', message: 'at least one binding is required' })
    }
    for (const [capability, binding] of entries) {
      if (binding && binding.capability !== capability) {
        context.addIssue({
          code: 'custom',
          message: 'binding capability does not match key',
        })
      }
    }
  })

export type GoogleContentRuntimeBindings = Readonly<
  Partial<Record<GoogleContentCapability, GoogleContentRuntimeBinding>>
>

export function parseGoogleContentRuntimeBindings(
  raw: string,
): GoogleContentRuntimeBindings {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Google Content runtime bindings JSON is invalid')
  }
  const parsed = runtimeBindingsSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Google Content runtime bindings are invalid')
  }
  return Object.freeze(parsed.data)
}
