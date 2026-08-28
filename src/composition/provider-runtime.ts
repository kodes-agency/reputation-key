import type { Env } from '#/shared/config/env'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from '#/contexts/integration/application/ports/google-oauth.port'
import type { GbpApiPort } from '#/contexts/integration/application/ports/gbp-api.port'
import type { GoogleAuthorizedProviderExecutor } from '#/contexts/integration/application/ports/google-authorized-provider-executor.port'
import type { GoogleImportReferenceStore } from '#/contexts/integration/application/ports/google-import-reference-store.port'
import type { GoogleImportContentAuthorizer } from '#/contexts/integration/application/google-import-command-authorizer'
import type { GoogleReviewCursorStore } from '#/contexts/integration/infrastructure/google-review-cursor-store'
import type { PerformanceContentAuthorizer } from '#/contexts/integration/application/google-performance-authorizer'
import type { GoogleReviewSyncContentAuthorizer } from '#/contexts/integration/application/google-review-sync-authorizer'
import type { GoogleReplyPublicationContentAuthorizer } from '#/contexts/integration/application/google-reply-publication-authorizer'
import type { PortalStoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { AiInferencePort } from '#/contexts/ai/application/ports/ai-inference.port'
import type { AiSubjectHmacPort } from '#/contexts/ai/application/ports/ai-subject-hmac.port'
import { createAiGatewayAdapter } from '#/contexts/ai/infrastructure/adapters/ai-gateway.adapter'
import { createAiSubjectHmacAdapter } from '#/contexts/ai/infrastructure/adapters/ai-subject-hmac.adapter'
import { loadNamedEd25519PublicKeyring } from '#/shared/ed25519-key-material'
import {
  assertAiAdmissionPublicKeyringInventory,
  assertAiProvenancePublicKeyringInventory,
  resolveAiGatewayRuntimeKeyInventory,
} from '#/shared/ai-gateway-key-inventory'
import { AI_INTERNAL_RESPONSE_MAX_BYTES } from '#/shared/ai-internal-transport-contract'
import type { AiGatewayCaller } from '#/shared/ai-gateway-transport-contract'
import {
  createInternalMtlsJsonTransport,
  loadInternalMtlsMaterialFromBase64,
} from '../../services/internal-mtls'

/**
 * External adapters are explicit container inputs. Absent overrides select the
 * production adapter at this root-owned boundary; contexts never inspect the
 * environment or select a provider implementation themselves.
 */
export type ProviderOverrides = Readonly<{
  googleOAuth?: GoogleOAuthPort
  gbpApi?: GbpApiPort
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  authorizeGoogleOAuthProviderCall?: GoogleOAuthProviderCallAuthorizer
  googleImportReferences?: GoogleImportReferenceStore
  googleReviewCursorStore?: GoogleReviewCursorStore
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  authorizeGoogleReviewSyncContent?: GoogleReviewSyncContentAuthorizer
  authorizeGoogleReplyPublicationContent?: GoogleReplyPublicationContentAuthorizer
  googlePerformancePrincipalKeys?: VersionedHmacKeyring
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  aiInference?: AiInferencePort
  aiSubjectHmac?: AiSubjectHmacPort
  storage?: PortalStoragePort
}>

const PROVIDER_ENDPOINTS: Readonly<Record<string, ProviderEndpoints>> = {
  'gbp-default': {
    gbpApiBaseUrl: 'https://mybusinessbusinessinformation.googleapis.com/v1',
    gbpAccountManagementBaseUrl: 'https://mybusinessaccountmanagement.googleapis.com/v1',
    gbpPerformanceBaseUrl: 'https://businessprofileperformance.googleapis.com/v1',
    reviewsApiBaseUrl: 'https://mybusiness.googleapis.com/v4',
    notificationsApiBaseUrl: 'https://mybusinessnotifications.googleapis.com/v1',
    oauthTokenUrl: 'https://oauth2.googleapis.com/token',
    oauthJwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    oauthRevokeUrl: 'https://oauth2.googleapis.com/revoke',
  },
}

/** Resolve a logical, catalogue-owned provider reference without a fallback. */
export function providerConfigFor(ref: string | undefined): ProviderEndpoints {
  const endpoints = ref ? PROVIDER_ENDPOINTS[ref] : undefined
  if (!endpoints) {
    throw new Error(
      `No approved provider configuration for ref '${ref ?? 'none'}' (ADR 0054/0057: provider refs come from an accepting catalogue target)`,
    )
  }
  return endpoints
}

/** Apply the explicit local-sandbox endpoint profile exactly once at build. */
export function applyProviderEndpointOverrides(
  endpoints: ProviderEndpoints,
  env: Env,
): ProviderEndpoints {
  const overrides = [
    env.GBP_API_BASE_URL,
    env.GBP_ACCOUNT_MANAGEMENT_BASE_URL,
    env.GBP_PERFORMANCE_BASE_URL,
    env.GBP_REVIEWS_API_BASE_URL,
    env.GBP_NOTIFICATIONS_API_BASE_URL,
    env.GOOGLE_OAUTH_TOKEN_URL,
    env.GOOGLE_OAUTH_JWKS_URL,
    env.GOOGLE_OAUTH_REVOKE_URL,
  ]
  if (
    env.NODE_ENV === 'production' &&
    env.GOOGLE_PROVIDER_ENDPOINT_PROFILE === 'local-sandbox'
  ) {
    throw new Error('production local-sandbox profile is unavailable')
  }
  if (env.NODE_ENV === 'production' && overrides.some((value) => value !== undefined)) {
    throw new Error(
      'provider endpoint overrides require a non-production local-sandbox profile',
    )
  }
  return {
    gbpApiBaseUrl: env.GBP_API_BASE_URL ?? endpoints.gbpApiBaseUrl,
    gbpAccountManagementBaseUrl:
      env.GBP_ACCOUNT_MANAGEMENT_BASE_URL ?? endpoints.gbpAccountManagementBaseUrl,
    gbpPerformanceBaseUrl:
      env.GBP_PERFORMANCE_BASE_URL ?? endpoints.gbpPerformanceBaseUrl,
    reviewsApiBaseUrl: env.GBP_REVIEWS_API_BASE_URL ?? endpoints.reviewsApiBaseUrl,
    notificationsApiBaseUrl:
      env.GBP_NOTIFICATIONS_API_BASE_URL ?? endpoints.notificationsApiBaseUrl,
    oauthTokenUrl: env.GOOGLE_OAUTH_TOKEN_URL ?? endpoints.oauthTokenUrl,
    oauthJwksUrl: env.GOOGLE_OAUTH_JWKS_URL ?? endpoints.oauthJwksUrl,
    oauthRevokeUrl: env.GOOGLE_OAUTH_REVOKE_URL ?? endpoints.oauthRevokeUrl,
  }
}

export type AiRuntimeProviders = Readonly<{
  inference?: AiInferencePort
  subjectHmac?: AiSubjectHmacPort
  provenancePublicKeys?: ReturnType<typeof loadNamedEd25519PublicKeyring>
}>

/**
 * Build the complete AI provider boundary from parsed config and an explicitly
 * supplied host-environment inventory. No helper in this module performs an
 * ambient environment read, so tests and process fixtures are deterministic.
 */
export function createAiRuntimeProviders(
  input: Readonly<{
    env: Env
    runtimeEnvironment: Readonly<Record<string, string | undefined>>
    enableJobs: boolean
    inferenceOverride?: AiInferencePort
    subjectHmacOverride?: AiSubjectHmacPort
  }>,
): AiRuntimeProviders {
  const keyInventory = resolveAiGatewayRuntimeKeyInventory({
    ...input.runtimeEnvironment,
    AI_KEY_INVENTORY_PROFILE: input.env.AI_KEY_INVENTORY_PROFILE,
  })
  const gatewayConfig = [
    input.env.AI_EGRESS_GATEWAY_ORIGIN,
    input.env.AI_EGRESS_GATEWAY_SERVER_NAME,
    input.env.AI_INTERNAL_MTLS_CA_B64,
    input.env.AI_INTERNAL_MTLS_CERT_B64,
    input.env.AI_INTERNAL_MTLS_KEY_B64,
    input.env.AI_ADMISSION_ED25519_PUBLIC_KEYS_JSON,
  ] as const
  const configured = gatewayConfig.filter((value): value is string => value !== undefined)
  if (configured.length !== 0 && configured.length !== gatewayConfig.length) {
    throw new Error('AI egress gateway transport configuration is incomplete')
  }
  if (!input.enableJobs && input.env.AI_SUBJECT_HMAC_KEYS !== undefined) {
    throw new Error('AI subject HMAC authority is worker-only')
  }

  const caller: AiGatewayCaller = input.enableJobs ? 'worker' : 'web'
  let inference = input.inferenceOverride
  if (!inference && configured.length > 0) {
    const [origin, serverName, ca, cert, key, publicKeysJson] = configured
    const publicKeys = loadNamedEd25519PublicKeyring(
      publicKeysJson,
      [
        keyInventory.admissionSigning.activeKid,
        ...keyInventory.admissionSigning.retainedKids,
      ],
      keyInventory.admissionSigning.maximumConfiguredKeys,
    )
    assertAiAdmissionPublicKeyringInventory(publicKeys, keyInventory)
    inference = createAiGatewayAdapter({
      transport: createInternalMtlsJsonTransport({
        origin,
        serverName,
        tls: loadInternalMtlsMaterialFromBase64({ ca, cert, key }),
        peerIdentityPolicy: {
          uri: 'spiffe://repkey.internal/ai-egress-gateway',
          dnsName: serverName,
          extendedKeyUsages: ['serverAuth', 'clientAuth'],
        },
        timeoutMs: 105_000,
        maxResponseBytes: AI_INTERNAL_RESPONSE_MAX_BYTES,
      }),
      caller,
      admissionSettlementPublicKeys: publicKeys,
    })
  }

  const provenancePublicKeys = input.env.AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON
    ? loadNamedEd25519PublicKeyring(
        input.env.AI_PROVENANCE_ED25519_PUBLIC_KEYS_JSON,
        [keyInventory.provenance.activeKid],
        keyInventory.provenance.maximumPrivateKeysPerProcess,
      )
    : undefined
  if (provenancePublicKeys) {
    assertAiProvenancePublicKeyringInventory(provenancePublicKeys, keyInventory)
  } else if (!input.enableJobs && configured.length > 0) {
    throw new Error('AI provenance public keyring is unavailable')
  }

  const subjectHmac =
    input.subjectHmacOverride ??
    (input.env.AI_SUBJECT_HMAC_KEYS
      ? createAiSubjectHmacAdapter(input.env.AI_SUBJECT_HMAC_KEYS)
      : undefined)
  if (input.enableJobs && inference !== undefined && subjectHmac === undefined) {
    throw new Error('AI worker subject HMAC authority is unavailable')
  }
  return Object.freeze({ inference, subjectHmac, provenancePublicKeys })
}
