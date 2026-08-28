import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { merchantAiEnablement } from '#/shared/db/schema'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'
import type {
  AiAuthorizationPort,
  AiMerchantAuthorizationSnapshot,
} from '../../application/ports/ai-authorization.port'
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-operation-profiles'

function isCapability(value: string): value is MerchantAiCapability {
  return (
    value === 'review_analysis' ||
    value === 'reply_drafting' ||
    value === 'property_trends'
  )
}

function parseCapabilities(
  values: ReadonlyArray<string>,
): ReadonlyArray<MerchantAiCapability> {
  if (!values.every(isCapability)) {
    throw new Error('Merchant AI authorization contains an unknown capability')
  }
  return values
}

function parseRuntimeProfiles(
  value: Readonly<Record<string, string>>,
): Readonly<Partial<Record<MerchantAiCapability, string>>> {
  const result: Partial<Record<MerchantAiCapability, string>> = {}
  for (const [capability, profile] of Object.entries(value)) {
    if (!isCapability(capability) || profile.length === 0) {
      throw new Error('Merchant AI authorization contains an invalid runtime profile')
    }
    result[capability] = profile
  }
  return result
}

export const createAiAuthorizationAdapter = (db: Database): AiAuthorizationPort => {
  return {
    async readMerchantAuthorization(
      input,
    ): Promise<AiMerchantAuthorizationSnapshot | null> {
      const [row] = await db
        .select()
        .from(merchantAiEnablement)
        .where(
          and(
            eq(merchantAiEnablement.organizationId, input.organizationId),
            eq(merchantAiEnablement.propertyId, input.propertyId),
          ),
        )
        .limit(1)
      if (!row) return null

      if (row.sourcePolicyId !== AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId) {
        throw new Error('Merchant AI authorization source profile is unavailable')
      }
      const changedAtEpochMillis = row.updatedAt.getTime()
      return {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        state: row.state as 'disabled' | 'enabled' | 'revoked',
        stateVersion: row.stateVersion,
        authorizationLineageId:
          row.state === 'enabled' ? row.authorizationLineageId : null,
        authorizedSourceEpoch: row.authorizedSourceEpoch,
        capabilities: parseCapabilities(row.capabilities),
        capabilityRuntimeProfileVersions: parseRuntimeProfiles(
          row.capabilityRuntimeProfileVersions,
        ),
        capabilityEpochs: {
          review_analysis: {
            epoch: row.reviewAnalysisEpoch,
            changedAtEpochMillis,
          },
          reply_drafting: {
            epoch: row.replyDraftingEpoch,
            changedAtEpochMillis,
          },
          property_trends: {
            epoch: row.propertyTrendsEpoch,
            changedAtEpochMillis,
          },
        },
        reviewAnalysisStartSequence: row.analysisStartSequence,
        noticeVersion: row.noticeVersion,
        noticeDigest: row.noticeDigest,
        sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
        sourceCanonicalizerDigest:
          AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
        redactionProfileFamily: row.redactionProfileFamily,
        providerDeploymentProfileVersion: row.providerDeploymentProfileVersion,
      }
    },
  }
}
