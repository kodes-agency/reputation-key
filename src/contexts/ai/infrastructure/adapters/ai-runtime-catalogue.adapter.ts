import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiOperationProfiles,
  aiProviderDeploymentCapabilities,
  aiProviderDeploymentProfiles,
  aiRoutingPolicies,
  aiRuntimeCapabilityProfiles,
} from '#/shared/db/schema'
import {
  AI_RUNTIME_CAPABILITIES_V1,
  AI_RUNTIME_CAPABILITIES_V1_DIGEST,
  getAiRuntimeCapability,
} from '#/shared/ai-runtime-capability-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type {
  AiRuntimeCataloguePort,
  AiRuntimeCatalogueResult,
} from '../../application/ports/ai-runtime-catalogue.port'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
  getAiOperationProfile,
  type AiOperationProfile,
} from '#/shared/ai-operation-profiles'

const PROFILE_FIELDS = [
  'profileVersion',
  'command',
  'capability',
  'purpose',
  'sourceRoute',
  'gatewayPath',
  'callerRole',
  'capabilityRuntimeProfileVersion',
  'providerDeploymentProfileVersion',
  'outputSchemaName',
  'outputSchemaDigest',
  'promptDigest',
  'artifactAttestationsDigest',
  'sdkRequestShapeDigest',
  'staticTokenBearingBytes',
  'staticTokenBearingDigest',
  'sourceByteLimit',
  'providerPayloadByteLimit',
  'preparedRequestByteLimit',
  'responseByteLimit',
  'maxOutputTokens',
  'providerDeadlineMs',
  'requestDeadlineMs',
  'executionLeaseMs',
  'profileDigest',
] as const satisfies ReadonlyArray<keyof AiOperationProfile>

function operationMatches(
  actual: typeof aiOperationProfiles.$inferSelect,
  expected: AiOperationProfile,
): boolean {
  return (
    PROFILE_FIELDS.every((field) => actual[field] === expected[field]) &&
    canonicalizeRfc8785(actual.artifactAttestations) ===
      canonicalizeRfc8785(expected.artifactAttestations)
  )
}

function providerMatches(
  actual: typeof aiProviderDeploymentProfiles.$inferSelect,
): boolean {
  return (
    actual.profileVersion === AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion &&
    actual.region === AI_PROVIDER_DEPLOYMENT_PROFILE.region &&
    actual.provider === AI_PROVIDER_DEPLOYMENT_PROFILE.provider &&
    actual.modelSnapshot === AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot &&
    actual.reasoningEffort === AI_PROVIDER_DEPLOYMENT_PROFILE.reasoningEffort &&
    actual.serviceTier === AI_PROVIDER_DEPLOYMENT_PROFILE.serviceTier &&
    actual.store === AI_PROVIDER_DEPLOYMENT_PROFILE.store &&
    actual.responseApiVersion === AI_PROVIDER_DEPLOYMENT_PROFILE.responseApiVersion &&
    canonicalizeRfc8785(actual.deploymentContract) ===
      canonicalizeRfc8785(AI_PROVIDER_DEPLOYMENT_PROFILE.deploymentContract) &&
    actual.profileDigest === AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest
  )
}

function runtimeMatches(
  actual: typeof aiRuntimeCapabilityProfiles.$inferSelect,
  capability: MerchantAiCapability,
): boolean {
  const expected = getAiRuntimeCapability(capability)
  return (
    actual.runtimeProfileVersion === expected.runtimeProfileVersion &&
    actual.capability === expected.capability &&
    actual.purpose === expected.purpose &&
    actual.sourceRoute === expected.sourceRoute &&
    actual.gatewayPath === expected.gatewayPath &&
    actual.gatewayProfileVersion === expected.gatewayProfileVersion &&
    actual.caller === expected.caller &&
    actual.operationProfileVersion === expected.operationProfileVersion &&
    actual.providerDeploymentProfileVersion ===
      expected.providerDeploymentProfileVersion &&
    actual.noticeVersion === expected.noticeVersion &&
    actual.noticeDigest === expected.noticeDigest &&
    actual.catalogueDigest === AI_RUNTIME_CAPABILITIES_V1_DIGEST
  )
}

export const createAiRuntimeCatalogueAdapter = (db: Database): AiRuntimeCataloguePort => {
  async function loadComplete(): Promise<Readonly<{
    runtimeRows: ReadonlyArray<typeof aiRuntimeCapabilityProfiles.$inferSelect>
  }> | null> {
    try {
      const [providers, routing, operations, runtimeRows, memberships] =
        await Promise.all([
          db.select().from(aiProviderDeploymentProfiles),
          db.select().from(aiRoutingPolicies),
          db.select().from(aiOperationProfiles),
          db.select().from(aiRuntimeCapabilityProfiles),
          db.select().from(aiProviderDeploymentCapabilities),
        ])
      if (
        providers.length !== 1 ||
        !providerMatches(providers[0]!) ||
        routing.length !== 1 ||
        routing[0]!.version !== AI_ROUTING_POLICY.version ||
        routing[0]!.region !== AI_ROUTING_POLICY.region ||
        routing[0]!.providerDeploymentProfileVersion !==
          AI_ROUTING_POLICY.providerDeploymentProfileVersion ||
        routing[0]!.policyDigest !== AI_ROUTING_POLICY.policyDigest ||
        operations.length !== AI_OPERATION_PROFILES.length ||
        runtimeRows.length !== AI_RUNTIME_CAPABILITIES_V1.length ||
        memberships.length !== AI_RUNTIME_CAPABILITIES_V1.length
      ) {
        return null
      }
      for (const expected of AI_OPERATION_PROFILES) {
        const actual = operations.find(
          (row) => row.profileVersion === expected.profileVersion,
        )
        if (!actual || !operationMatches(actual, expected)) return null
      }
      for (const expected of AI_RUNTIME_CAPABILITIES_V1) {
        const runtime = runtimeRows.find(
          (row) => row.runtimeProfileVersion === expected.runtimeProfileVersion,
        )
        const membership = memberships.find(
          (row) =>
            row.providerDeploymentProfileVersion ===
              expected.providerDeploymentProfileVersion &&
            row.capability === expected.capability,
        )
        if (
          !runtime ||
          !runtimeMatches(runtime, expected.capability) ||
          !membership ||
          membership.runtimeProfileVersion !== expected.runtimeProfileVersion ||
          membership.catalogueDigest !== AI_RUNTIME_CAPABILITIES_V1_DIGEST
        ) {
          return null
        }
      }
      return { runtimeRows }
    } catch {
      return null
    }
  }

  return {
    async assertComplete() {
      return (await loadComplete()) !== null
    },
    async resolveCapability(capability): Promise<AiRuntimeCatalogueResult> {
      const loaded = await loadComplete()
      if (!loaded) return { status: 'policy_unavailable' }
      const runtime = getAiRuntimeCapability(capability)
      const row = await db
        .select({
          runtimeProfileVersion: aiRuntimeCapabilityProfiles.runtimeProfileVersion,
        })
        .from(aiRuntimeCapabilityProfiles)
        .where(eq(aiRuntimeCapabilityProfiles.capability, capability))
        .limit(2)
      if (
        row.length !== 1 ||
        row[0]!.runtimeProfileVersion !== runtime.runtimeProfileVersion
      ) {
        return { status: 'policy_unavailable' }
      }
      return {
        status: 'available',
        catalogue: {
          providerDeploymentProfileVersion: 'private-beta-global-v1',
          routingPolicyVersion: 1,
          runtime,
          operation: getAiOperationProfile(runtime.operationProfileVersion),
        },
      }
    },
  }
}
