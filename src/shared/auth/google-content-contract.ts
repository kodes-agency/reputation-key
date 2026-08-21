import { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from '#/shared/google-provider-control/contracts'

export const GOOGLE_CONTENT_CAPABILITIES = [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
] as const
export type GoogleContentCapability = (typeof GOOGLE_CONTENT_CAPABILITIES)[number]
export function isGoogleContentCapability(
  value: string,
): value is GoogleContentCapability {
  return GOOGLE_CONTENT_CAPABILITIES.some((capability) => capability === value)
}

export const GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION = 'beta-local-2' as const
export const GOOGLE_CONTENT_EXECUTION_POLICY_VERSION = 'beta-local-2' as const
export const GOOGLE_CONTENT_POLICY_VERSION = 'google-content-live-1' as const
export const GOOGLE_OAUTH_CONTRACT_VERSION = 'google-oauth-oidc-1' as const
export const GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION =
  'google-content-egress-1' as const
export const GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION = '2026-08-05' as const
/**
 * The provider route catalogue version is approval-bound material, not merely a
 * cross-service consistency check. It fixes the Performance route URL, the wire
 * `dailyMetrics` set, the dailyRange encoding, page size and the response cap —
 * i.e. exactly what the compliance approval attests to. Sourced from the single
 * definition in `#/shared/google-provider-control/contracts` rather than copied,
 * so a catalogue bump cannot silently satisfy a stale approval row.
 */
export { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION }

export const GOOGLE_CONTENT_APPROVAL_TARGET_PHASES = [
  'local_sandbox',
  'railway_closed_beta',
  'production_expand_canary',
  'production_final',
] as const
export type GoogleContentApprovalTargetPhase =
  (typeof GOOGLE_CONTENT_APPROVAL_TARGET_PHASES)[number]

export const GOOGLE_CONTENT_ENVIRONMENT_PROFILES = [
  'sandbox',
  'railway-closed-beta-1',
  'production',
] as const
export type GoogleContentEnvironmentProfile =
  (typeof GOOGLE_CONTENT_ENVIRONMENT_PROFILES)[number]

export const GOOGLE_CONTENT_APPROVAL_ROLES = [
  'engineering/runtime',
  'product/property',
  'security/privacy',
  'google-project/integration',
  'operations/on-call',
] as const
export type GoogleContentApprovalRole = (typeof GOOGLE_CONTENT_APPROVAL_ROLES)[number]

export const GOOGLE_CONTENT_IMAGE_ROLES = [
  'web',
  'worker',
  'googleExecutionAdmission',
  'googleEgressGateway',
  'providerEphemeralRedis',
] as const
export type GoogleContentImageRole = (typeof GOOGLE_CONTENT_IMAGE_ROLES)[number]
export type GoogleContentImageDigests = Readonly<Record<GoogleContentImageRole, string>>

export const GOOGLE_CONTENT_APPROVAL_STATUSES = [
  'approved',
  'suspended',
  'expired',
  'revoked',
] as const
export type GoogleContentApprovalStatus =
  (typeof GOOGLE_CONTENT_APPROVAL_STATUSES)[number]

export type GoogleContentApprovalBinding = Readonly<{
  capability: GoogleContentCapability
  targetPhase: GoogleContentApprovalTargetPhase
  environmentProfile: GoogleContentEnvironmentProfile
  releaseSha: string
  evidenceManifestSha256: string
  evidenceIndexSha256: string
  deploymentAttestationSha256: string
  adr0050Sha256: string
  googleContentPolicyVersion: typeof GOOGLE_CONTENT_POLICY_VERSION
  googleOAuthContractVersion: typeof GOOGLE_OAUTH_CONTRACT_VERSION
  googleProjectAttestationSha256: string
  googleOAuthClientIdSha256: string
  googleRedirectUriSha256: string
  providerOriginProfileSha256: string
  runtimeIsolationProfileVersion:
    typeof GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION | null
  runtimeIsolationProfileSha256: string | null
  railwayClosedBetaCohort: readonly string[] | null
  railwayClosedBetaCohortSha256: string | null
  railwayClosedBetaResidualRiskSha256: string | null
  performanceCatalogVersion: typeof GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION
  routeCatalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  capabilityPolicyVersion: typeof GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION
  executionPolicyVersion: typeof GOOGLE_CONTENT_EXECUTION_POLICY_VERSION
  migrationHead: string
  imageDigests: GoogleContentImageDigests
  approvedAt: string
  expiresAt: string
  status: GoogleContentApprovalStatus
}>

export type GoogleContentDecision = 'approved' | 'denied'

export type GoogleContentApprovalRoleDocument = Readonly<{
  role: GoogleContentApprovalRole
  capability: GoogleContentCapability
  manifestSha256: string
  releaseSha: string
  targetPhase: GoogleContentApprovalTargetPhase
  environmentProfile: GoogleContentEnvironmentProfile
  transientPerformanceReportingDecision: GoogleContentDecision
  confirmedImportProfileTreatmentDecision: GoogleContentDecision
  unmanagedUserAgentMemoryResidualDecision: GoogleContentDecision
  railwayClosedBetaResidualDecision: GoogleContentDecision | null
  railwayClosedBetaCohortSha256: string | null
  railwayClosedBetaResidualRiskSha256: string | null
  approverIdentity: string
  approvedAt: string
  expiresAt: string
  signature: string
}>

export type GoogleContentEvidenceIndex = Readonly<{
  manifestSha256: string
  artifactSha256: Readonly<Record<string, string>>
  roleDocumentSha256: Readonly<Record<GoogleContentApprovalRole, string>>
}>

export type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'

export const GOOGLE_RUNTIME_ROLES = [
  'web',
  'worker',
  'execution_admission',
  'egress_gateway',
  'provider_redis',
] as const
export type GoogleRuntimeRole = (typeof GOOGLE_RUNTIME_ROLES)[number]

export type GoogleContentRuntimeIsolationProfile = Readonly<{
  version: typeof GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION
  enforcementPlane: 'infrastructure-control-plane'
  targetEnvironment: 'local_sandbox' | 'production'
  destinationEnforcement:
    'namespace_firewall' | 'cni_network_policy' | 'cloud_egress_firewall'
  imageDigests: Readonly<Record<GoogleRuntimeRole, string>>
  protectedReplicas: readonly Readonly<{
    replicaId: string
    role: GoogleRuntimeRole
    workloadIdentity: string
    networkNamespaceIdentity: string
    imageSha256: string
    networkPolicyId: string
  }>[]
  ipv4EgressDefault: 'deny'
  ipv6EgressDefault: 'deny'
  dnsResolverIdentity: string
  allowedInternalTuples: readonly Readonly<{
    sourceIdentity: string
    destinationIdentity: string
    protocol: 'tcp' | 'udp'
    port: number
  }>[]
  allowedGoogleOrigins: readonly string[]
  controlPlanePolicyGeneration: string
}>

export const CREDENTIAL_REVOKE_PERMIT_STATES = [
  'dormant',
  'active',
  'dispatching',
  'consumed_no_revoke',
  'confirmed_not_sent',
  'confirmed_revoked',
  'cleanup_ambiguous',
  'provider_reset_confirmed',
] as const
export type CredentialRevokePermitState = (typeof CREDENTIAL_REVOKE_PERMIT_STATES)[number]

export const GOOGLE_CREDENTIAL_SOURCE_OPERATION_STATES = [
  'registered',
  'provider_started',
  'terminal',
  'provider_outcome_ambiguous',
  'provider_reset_terminal',
] as const
export type GoogleCredentialSourceOperationState =
  (typeof GOOGLE_CREDENTIAL_SOURCE_OPERATION_STATES)[number]

export const CREDENTIAL_CLEANUP_OUTCOMES = [
  'confirmed_not_sent',
  'confirmed_revoked',
  'cleanup_ambiguous',
] as const
export type CredentialCleanupOutcome = (typeof CREDENTIAL_CLEANUP_OUTCOMES)[number]
export type SubjectAuthorityRecoveryState = 'provider_reset_required' | 'ambiguous'

export function isCleanupOutcomeDrained(outcome: CredentialCleanupOutcome): boolean {
  return outcome === 'confirmed_revoked'
}

export function cleanupOutcomeRequiresProviderReset(
  outcome: CredentialCleanupOutcome,
): SubjectAuthorityRecoveryState | null {
  switch (outcome) {
    case 'confirmed_revoked':
      return null
    case 'confirmed_not_sent':
      return 'provider_reset_required'
    case 'cleanup_ambiguous':
      return 'ambiguous'
  }
}
