import type {
  CapabilityRuntimeProfileVersions,
  MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'

export {
  CURRENT_MERCHANT_AI_CAPABILITIES,
  type MerchantAiCapability,
} from '#/shared/domain/merchant-ai-capability'

export type CurrentMerchantAiCapability = MerchantAiCapability
export type MerchantAiState = 'disabled' | 'enabled' | 'revoked'

export type MerchantAiCapabilityEpochs = Readonly<Record<MerchantAiCapability, number>>

export type MerchantAiSnapshot = Readonly<{
  organizationId: string
  propertyId: string
  state: MerchantAiState
  authorizationLineageId: string | null
  capabilities: ReadonlyArray<MerchantAiCapability>
  capabilityRuntimeProfileVersions: CapabilityRuntimeProfileVersions
  capabilityEpochs: MerchantAiCapabilityEpochs
  authorizedSourceEpoch: number
  analysisStartSequence: number
  stateVersion: number
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  routingPolicyVersion: number
  processingRegion: 'global'
  providerDeploymentProfileVersion: 'private-beta-global-v1'
  redactionProfileFamily: string
}>
