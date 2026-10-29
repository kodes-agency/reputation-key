import { openAiPairingOf } from './ai-openai-provider-attestation'
import { logicalOperationProfileOf } from './ai-operation-profile-views'
import { AI_OPERATION_PROFILES } from './ai-operation-profiles'
import type { AiProviderId } from './ai-provider-ids'
import type { AiOperationProviderPairing } from './ai-provider-attestations'
import {
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
  REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
} from './review-analysis-v3-profile'

// What each provider reserves for each operation profile (contract section 7.1):
// the tokens its static request holds before the first payload byte. Admission
// prices a reservation from this for an operation that records a provider; an
// operation that records none is a v2 operation and is priced from its profile's
// own OpenAI-shaped figure, as it always was. A (profile, provider) pair with no
// entry cannot be reserved, so a provider serves nothing it has no pairing for:
// there is no default pairing to fall back to. The Anthropic adapter (slice 3.6)
// adds its pairing for the v3 profile here.

const PAIRINGS: ReadonlyMap<string, AiOperationProviderPairing> = new Map([
  ...AI_OPERATION_PROFILES.map((profile) => {
    const pairing = openAiPairingOf(logicalOperationProfileOf(profile))
    return [`${profile.profileVersion}:${pairing.providerId}`, pairing] as const
  }),
  [
    `${REVIEW_ANALYSIS_V3_LOGICAL_PROFILE.profileVersion}:${REVIEW_ANALYSIS_V3_OPENAI_PAIRING.providerId}`,
    REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
  ],
])

export function operationProviderPairing(
  profileVersion: string,
  providerId: AiProviderId,
): AiOperationProviderPairing | null {
  return PAIRINGS.get(`${profileVersion}:${providerId}`) ?? null
}
