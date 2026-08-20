import type { AiRuntimeCapabilityV1 } from '#/shared/ai-runtime-capability-contract'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type { AiOperationProfile } from '../../../../shared/ai-operation-profiles'

export type AiResolvedRuntimeCatalogue = Readonly<{
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  routingPolicyVersion: 1
  runtime: AiRuntimeCapabilityV1
  operation: AiOperationProfile
}>

export type AiRuntimeCatalogueResult =
  | Readonly<{ status: 'available'; catalogue: AiResolvedRuntimeCatalogue }>
  | Readonly<{ status: 'policy_unavailable' }>

export type AiRuntimeCataloguePort = Readonly<{
  resolveCapability(capability: MerchantAiCapability): Promise<AiRuntimeCatalogueResult>
  assertComplete(): Promise<boolean>
}>
