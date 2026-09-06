import { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from '#/shared/google-provider-control/contracts'
import { GOOGLE_CONTENT_EXECUTION_POLICY_VERSION } from '#/shared/domain/google-content-authorization-vector'

export { GOOGLE_CONTENT_EXECUTION_POLICY_VERSION }

export const GOOGLE_CONTENT_CAPABILITIES = [
  'property.import_gbp_v2',
  'property.read_gbp_performance',
  'property.connect_gbp',
  'property.publish_reply',
] as const
export type GoogleContentCapability = (typeof GOOGLE_CONTENT_CAPABILITIES)[number]
export function isGoogleContentCapability(
  value: string,
): value is GoogleContentCapability {
  return GOOGLE_CONTENT_CAPABILITIES.some((capability) => capability === value)
}

export const GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION = 'beta-local-2' as const
export const GOOGLE_CONTENT_POLICY_VERSION = 'google-content-live-1' as const
export const GOOGLE_OAUTH_CONTRACT_VERSION = 'google-oauth-oidc-1' as const
export const GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION =
  'google-content-egress-1' as const
export const GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION = '2026-08-05' as const
/**
 * Shared provider route catalogue version. It fixes the Performance route URL,
 * wire `dailyMetrics` set, dailyRange encoding, page size and response cap so
 * admission and execution cannot silently disagree. It is sourced from the
 * single definition in `#/shared/google-provider-control/contracts` rather
 * than copied.
 */
export { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION }

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
