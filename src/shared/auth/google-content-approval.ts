import { createHash, verify as verifySignature } from 'node:crypto'
import { z } from 'zod'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_CONTENT_APPROVAL_STATUSES,
  GOOGLE_CONTENT_APPROVAL_TARGET_PHASES,
  GOOGLE_CONTENT_CAPABILITIES,
  GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  GOOGLE_CONTENT_ENVIRONMENT_PROFILES,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_CONTENT_POLICY_VERSION,
  GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION,
  GOOGLE_OAUTH_CONTRACT_VERSION,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRole,
  type GoogleContentApprovalRoleDocument,
  type GoogleContentEvidenceIndex,
} from './google-content-contract'
export type GoogleContentApprovalCandidate = Readonly<{
  binding: GoogleContentApprovalBinding
  index: GoogleContentEvidenceIndex & Readonly<{ sha256: string }>
  roleDocuments: readonly Readonly<{
    sha256: string
    document: GoogleContentApprovalRoleDocument
  }>[]
}>
export type GoogleContentApprovalSignatureVerifier = (
  document: GoogleContentApprovalRoleDocument,
) => boolean

export type GoogleContentApprovalValidationCode =
  | 'binding_not_approved'
  | 'binding_expired'
  | 'invalid_phase_profile'
  | 'invalid_approval_window'
  | 'invalid_railway_cohort'
  | 'railway_cohort_digest_mismatch'
  | 'railway_residual_binding_mismatch'
  | 'railway_residual_risk_denied'
  | 'railway_approval_owner_mismatch'
  | 'index_digest_mismatch'
  | 'manifest_digest_mismatch'
  | 'deployment_artifact_mismatch'
  | 'missing_role_approval'
  | 'duplicate_role_approval'
  | 'role_digest_mismatch'
  | 'role_manifest_mismatch'
  | 'role_binding_mismatch'
  | 'role_window_mismatch'
  | 'content_treatment_denied'
  | 'invalid_role_signature'

export type GoogleContentApprovalValidationResult =
  | Readonly<{ ok: true; binding: GoogleContentApprovalBinding }>
  | Readonly<{ ok: false; code: GoogleContentApprovalValidationCode }>

const HOUR_MS = 60 * 60 * 1_000

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('canonical JSON requires finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (typeof value !== 'object') {
    throw new TypeError('canonical JSON value is not serializable')
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`)
  return `{${entries.join(',')}}`
}

/** SHA-256 over deterministic key-sorted JSON bytes used by the approval chain. */
export function canonicalGoogleContentSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export type GoogleContentApprovalBundle = Readonly<{
  manifest: unknown
  candidate: GoogleContentApprovalCandidate
}>

export type GoogleContentRolePublicKeys = Readonly<
  Record<GoogleContentApprovalRole, string>
>

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const imageDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const instantSchema = z.string().datetime({ offset: true })

const approvalBindingSchema = z
  .object({
    capability: z.enum(GOOGLE_CONTENT_CAPABILITIES),
    targetPhase: z.enum(GOOGLE_CONTENT_APPROVAL_TARGET_PHASES),
    environmentProfile: z.enum(GOOGLE_CONTENT_ENVIRONMENT_PROFILES),
    releaseSha: z.string().min(1).max(128),
    evidenceManifestSha256: sha256Schema,
    evidenceIndexSha256: sha256Schema,
    deploymentAttestationSha256: sha256Schema,
    adr0050Sha256: sha256Schema,
    googleContentPolicyVersion: z.literal(GOOGLE_CONTENT_POLICY_VERSION),
    googleOAuthContractVersion: z.literal(GOOGLE_OAUTH_CONTRACT_VERSION),
    googleProjectAttestationSha256: sha256Schema,
    googleOAuthClientIdSha256: sha256Schema,
    googleRedirectUriSha256: sha256Schema,
    providerOriginProfileSha256: sha256Schema,
    runtimeIsolationProfileVersion: z
      .literal(GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION)
      .nullable(),
    runtimeIsolationProfileSha256: sha256Schema.nullable(),
    railwayClosedBetaCohort: z
      .array(z.string().min(1).max(255))
      .min(1)
      .max(100)
      .nullable(),
    railwayClosedBetaCohortSha256: sha256Schema.nullable(),
    railwayClosedBetaResidualRiskSha256: sha256Schema.nullable(),
    performanceCatalogVersion: z.literal(GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION),
    capabilityPolicyVersion: z.literal(GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION),
    executionPolicyVersion: z.literal(GOOGLE_CONTENT_EXECUTION_POLICY_VERSION),
    migrationHead: z.string().min(1).max(128),
    imageDigests: z
      .object({
        web: imageDigestSchema,
        worker: imageDigestSchema,
        googleExecutionAdmission: imageDigestSchema,
        googleEgressGateway: imageDigestSchema,
        providerEphemeralRedis: imageDigestSchema,
      })
      .strict(),
    approvedAt: instantSchema,
    expiresAt: instantSchema,
    status: z.enum(GOOGLE_CONTENT_APPROVAL_STATUSES),
  })
  .strict()

const roleDocumentSchema = z
  .object({
    role: z.enum(GOOGLE_CONTENT_APPROVAL_ROLES),
    capability: z.enum(GOOGLE_CONTENT_CAPABILITIES),
    manifestSha256: sha256Schema,
    releaseSha: z.string().min(1).max(128),
    targetPhase: z.enum(GOOGLE_CONTENT_APPROVAL_TARGET_PHASES),
    environmentProfile: z.enum(GOOGLE_CONTENT_ENVIRONMENT_PROFILES),
    transientPerformanceReportingDecision: z.enum(['approved', 'denied']),
    confirmedImportProfileTreatmentDecision: z.enum(['approved', 'denied']),
    unmanagedUserAgentMemoryResidualDecision: z.enum(['approved', 'denied']),
    railwayClosedBetaResidualDecision: z.enum(['approved', 'denied']).nullable(),
    railwayClosedBetaCohortSha256: sha256Schema.nullable(),
    railwayClosedBetaResidualRiskSha256: sha256Schema.nullable(),
    approverIdentity: z.string().min(1).max(200),
    approvedAt: instantSchema,
    expiresAt: instantSchema,
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .max(2048),
  })
  .strict()

const roleDocumentSha256Schema = z
  .object({
    'engineering/runtime': sha256Schema,
    'product/property': sha256Schema,
    'security/privacy': sha256Schema,
    'google-project/integration': sha256Schema,
    'operations/on-call': sha256Schema,
  })
  .strict()

const candidateSchema = z
  .object({
    binding: approvalBindingSchema,
    index: z
      .object({
        sha256: sha256Schema,
        manifestSha256: sha256Schema,
        artifactSha256: z
          .record(z.string().min(1).max(100), sha256Schema)
          .refine((record) => Object.keys(record).length <= 100),
        roleDocumentSha256: roleDocumentSha256Schema,
      })
      .strict(),
    roleDocuments: z
      .array(z.object({ sha256: sha256Schema, document: roleDocumentSchema }).strict())
      .max(GOOGLE_CONTENT_APPROVAL_ROLES.length),
  })
  .strict()

const bundleSchema = z
  .object({
    manifest: z.json(),
    candidate: candidateSchema,
  })
  .strict()

export function parseGoogleContentApprovalBundle(
  input: unknown,
): Readonly<{ ok: true; bundle: GoogleContentApprovalBundle }> | Readonly<{ ok: false }> {
  const result = bundleSchema.safeParse(input)
  return result.success ? { ok: true, bundle: result.data } : { ok: false }
}

export function googleContentRoleSignaturePayload(
  document: GoogleContentApprovalRoleDocument,
): Buffer {
  const { signature: _signature, ...payload } = document
  return Buffer.from(canonicalJson(payload), 'utf8')
}

const rolePublicKeysSchema = z
  .object({
    'engineering/runtime': z.string().min(1).max(16_384),
    'product/property': z.string().min(1).max(16_384),
    'security/privacy': z.string().min(1).max(16_384),
    'google-project/integration': z.string().min(1).max(16_384),
    'operations/on-call': z.string().min(1).max(16_384),
  })
  .strict()

export function parseGoogleContentRolePublicKeys(
  input: unknown,
):
  | Readonly<{ ok: true; publicKeys: GoogleContentRolePublicKeys }>
  | Readonly<{ ok: false }> {
  const result = rolePublicKeysSchema.safeParse(input)
  return result.success ? { ok: true, publicKeys: result.data } : { ok: false }
}

export function createGoogleContentRoleSignatureVerifier(
  publicKeys: GoogleContentRolePublicKeys,
): GoogleContentApprovalSignatureVerifier {
  return (document) => {
    try {
      return verifySignature(
        null,
        googleContentRoleSignaturePayload(document),
        publicKeys[document.role],
        Buffer.from(document.signature, 'base64'),
      )
    } catch {
      return false
    }
  }
}
const DAY_MS = 24 * HOUR_MS

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function expectedEnvironmentProfile(
  phase: GoogleContentApprovalBinding['targetPhase'],
): GoogleContentApprovalBinding['environmentProfile'] {
  switch (phase) {
    case 'local_sandbox':
      return 'sandbox'
    case 'railway_closed_beta':
      return 'railway-closed-beta-1'
    case 'production_expand_canary':
    case 'production_final':
      return 'production'
  }
}

function maximumApprovalWindowMs(
  phase: GoogleContentApprovalBinding['targetPhase'],
): number {
  if (phase === 'railway_closed_beta') return 30 * DAY_MS
  return phase === 'production_expand_canary' ? 72 * HOUR_MS : 90 * DAY_MS
}

function isRailwayClosedBeta(binding: GoogleContentApprovalBinding): boolean {
  return binding.targetPhase === 'railway_closed_beta'
}

function validRailwayCohort(organizations: readonly string[]): boolean {
  if (
    organizations.length === 0 ||
    new Set(organizations).size !== organizations.length
  ) {
    return false
  }
  return organizations.every(
    (organizationId) =>
      organizationId !== '*' &&
      organizationId.trim() === organizationId &&
      organizationId.length > 0 &&
      organizationId.length <= 255,
  )
}

function validatePhaseProfile(
  binding: GoogleContentApprovalBinding,
): GoogleContentApprovalValidationCode | null {
  if (binding.environmentProfile !== expectedEnvironmentProfile(binding.targetPhase)) {
    return 'invalid_phase_profile'
  }
  if (isRailwayClosedBeta(binding)) {
    if (
      binding.runtimeIsolationProfileVersion !== null ||
      binding.runtimeIsolationProfileSha256 !== null ||
      binding.railwayClosedBetaCohort === null ||
      binding.railwayClosedBetaCohortSha256 === null ||
      binding.railwayClosedBetaResidualRiskSha256 === null
    ) {
      return 'invalid_phase_profile'
    }
    if (!validRailwayCohort(binding.railwayClosedBetaCohort)) {
      return 'invalid_railway_cohort'
    }
    return canonicalGoogleContentSha256(binding.railwayClosedBetaCohort) ===
      binding.railwayClosedBetaCohortSha256
      ? null
      : 'railway_cohort_digest_mismatch'
  }
  return binding.runtimeIsolationProfileVersion ===
    GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION &&
    binding.runtimeIsolationProfileSha256 !== null &&
    binding.railwayClosedBetaCohort === null &&
    binding.railwayClosedBetaCohortSha256 === null &&
    binding.railwayClosedBetaResidualRiskSha256 === null
    ? null
    : 'invalid_phase_profile'
}

function treatmentApproved(document: GoogleContentApprovalRoleDocument): boolean {
  if (document.confirmedImportProfileTreatmentDecision !== 'approved') return false
  if (document.capability === 'property.import_gbp_v2') return true
  return (
    document.transientPerformanceReportingDecision === 'approved' &&
    document.unmanagedUserAgentMemoryResidualDecision === 'approved'
  )
}

export function validateGoogleContentApprovalCandidate(
  candidate: GoogleContentApprovalCandidate,
  now: Date,
  verifyRoleApproval: GoogleContentApprovalSignatureVerifier,
): GoogleContentApprovalValidationResult {
  const { binding, index, roleDocuments } = candidate
  if (binding.status !== 'approved') {
    return { ok: false, code: 'binding_not_approved' }
  }

  const approvedAt = parseInstant(binding.approvedAt)
  const expiresAt = parseInstant(binding.expiresAt)
  if (expiresAt === null || now.getTime() >= expiresAt) {
    return { ok: false, code: 'binding_expired' }
  }
  const phaseProfileCode = validatePhaseProfile(binding)
  if (phaseProfileCode) {
    return { ok: false, code: phaseProfileCode }
  }
  if (
    approvedAt === null ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > maximumApprovalWindowMs(binding.targetPhase)
  ) {
    return { ok: false, code: 'invalid_approval_window' }
  }

  const { sha256: suppliedIndexSha256, ...indexDocument } = index
  try {
    if (canonicalGoogleContentSha256(indexDocument) !== suppliedIndexSha256) {
      return { ok: false, code: 'index_digest_mismatch' }
    }
  } catch {
    return { ok: false, code: 'index_digest_mismatch' }
  }
  if (index.sha256 !== binding.evidenceIndexSha256) {
    return { ok: false, code: 'index_digest_mismatch' }
  }
  if (
    index.manifestSha256 !== binding.evidenceManifestSha256 ||
    roleDocuments.some(
      ({ document }) => document.manifestSha256 !== binding.evidenceManifestSha256,
    )
  ) {
    return { ok: false, code: 'role_manifest_mismatch' }
  }
  if (index.artifactSha256.deployment !== binding.deploymentAttestationSha256) {
    return { ok: false, code: 'deployment_artifact_mismatch' }
  }

  const byRole = new Map<GoogleContentApprovalRole, (typeof roleDocuments)[number]>()
  for (const entry of roleDocuments) {
    if (byRole.has(entry.document.role)) {
      return { ok: false, code: 'duplicate_role_approval' }
    }
    byRole.set(entry.document.role, entry)
  }
  if (
    byRole.size !== GOOGLE_CONTENT_APPROVAL_ROLES.length ||
    GOOGLE_CONTENT_APPROVAL_ROLES.some((role) => !byRole.has(role))
  ) {
    return { ok: false, code: 'missing_role_approval' }
  }

  let latestRoleApproval = Number.NEGATIVE_INFINITY
  let railwayApprovalOwner: string | null = null
  for (const role of GOOGLE_CONTENT_APPROVAL_ROLES) {
    const entry = byRole.get(role)
    if (!entry) return { ok: false, code: 'missing_role_approval' }
    try {
      if (canonicalGoogleContentSha256(entry.document) !== entry.sha256) {
        return { ok: false, code: 'role_digest_mismatch' }
      }
    } catch {
      return { ok: false, code: 'role_digest_mismatch' }
    }
    if (index.roleDocumentSha256[role] !== entry.sha256) {
      return { ok: false, code: 'role_digest_mismatch' }
    }

    const document = entry.document
    if (!verifyRoleApproval(document)) {
      return { ok: false, code: 'invalid_role_signature' }
    }
    if (isRailwayClosedBeta(binding)) {
      if (railwayApprovalOwner === null) {
        railwayApprovalOwner = document.approverIdentity
      } else if (document.approverIdentity !== railwayApprovalOwner) {
        return { ok: false, code: 'railway_approval_owner_mismatch' }
      }
    }
    if (document.manifestSha256 !== index.manifestSha256) {
      return { ok: false, code: 'manifest_digest_mismatch' }
    }
    if (
      document.capability !== binding.capability ||
      document.releaseSha !== binding.releaseSha ||
      document.targetPhase !== binding.targetPhase ||
      document.environmentProfile !== binding.environmentProfile
    ) {
      return { ok: false, code: 'role_binding_mismatch' }
    }
    if (document.expiresAt !== binding.expiresAt) {
      return { ok: false, code: 'role_window_mismatch' }
    }
    const roleApprovedAt = parseInstant(document.approvedAt)
    if (roleApprovedAt === null || roleApprovedAt >= expiresAt) {
      return { ok: false, code: 'role_window_mismatch' }
    }
    latestRoleApproval = Math.max(latestRoleApproval, roleApprovedAt)
    if (!treatmentApproved(document)) {
      return { ok: false, code: 'content_treatment_denied' }
    }
    if (isRailwayClosedBeta(binding)) {
      if (document.railwayClosedBetaResidualDecision !== 'approved') {
        return { ok: false, code: 'railway_residual_risk_denied' }
      }
      if (
        document.railwayClosedBetaCohortSha256 !==
          binding.railwayClosedBetaCohortSha256 ||
        document.railwayClosedBetaResidualRiskSha256 !==
          binding.railwayClosedBetaResidualRiskSha256
      ) {
        return { ok: false, code: 'railway_residual_binding_mismatch' }
      }
    } else if (
      document.railwayClosedBetaResidualDecision !== null ||
      document.railwayClosedBetaCohortSha256 !== null ||
      document.railwayClosedBetaResidualRiskSha256 !== null
    ) {
      return { ok: false, code: 'railway_residual_binding_mismatch' }
    }
  }

  if (latestRoleApproval !== approvedAt) {
    return { ok: false, code: 'role_window_mismatch' }
  }

  return { ok: true, binding }
}

export function validateGoogleContentApprovalBundle(
  bundle: GoogleContentApprovalBundle,
  now: Date,
  verifyRoleApproval: GoogleContentApprovalSignatureVerifier,
): GoogleContentApprovalValidationResult {
  try {
    if (
      canonicalGoogleContentSha256(bundle.manifest) !==
      bundle.candidate.binding.evidenceManifestSha256
    ) {
      return { ok: false, code: 'manifest_digest_mismatch' }
    }
  } catch {
    return { ok: false, code: 'manifest_digest_mismatch' }
  }
  return validateGoogleContentApprovalCandidate(bundle.candidate, now, verifyRoleApproval)
}
