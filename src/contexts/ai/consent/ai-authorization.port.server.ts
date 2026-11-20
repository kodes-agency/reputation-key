import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

export type AiMerchantAuthorizationSnapshot = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: 'disabled' | 'enabled' | 'revoked'
  stateVersion: number
  authorizationLineageId: string | null
  authorizedSourceEpoch: number
  capabilities: ReadonlyArray<MerchantAiCapability>
  capabilityRuntimeProfileVersions: Readonly<
    Partial<Record<MerchantAiCapability, string>>
  >
  capabilityEpochs: Readonly<
    Record<
      MerchantAiCapability,
      Readonly<{ epoch: number; changedAtEpochMillis: number | null }>
    >
  >
  reviewAnalysisStartSequence: number
  noticeVersion: string
  noticeDigest: string
  sourcePolicyId: string
  sourceCanonicalizerDigest: string
  redactionProfileFamily: string
  providerDeploymentProfileVersion: string
}>

export type AiAuthorizationPort = Readonly<{
  readMerchantAuthorization(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
    }>,
  ): Promise<AiMerchantAuthorizationSnapshot | null>
}>
