import type { AiProviderId } from './ai-provider-ids'
import type { AiOperationProviderPairing } from './ai-provider-attestations'
import {
  SYNTHETIC_CANARY_LOGICAL_PROFILE,
  SYNTHETIC_CANARY_OPENAI_PAIRING,
} from './ai-operation-profiles'
import {
  REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING,
  REVIEW_ANALYSIS_V3_LOGICAL_PROFILE,
  REVIEW_ANALYSIS_V3_OPENAI_PAIRING,
} from './analysis/profile'
import {
  REPLY_DRAFTING_V2_LOGICAL_PROFILE,
  REPLY_DRAFTING_V2_OPENAI_PAIRING,
} from './reply/profile'

// What each provider reserves for each operation profile (contract section 7.1):
// the tokens its static request holds before the first payload byte. Admission
// prices a reservation from this for an operation that records a provider. A
// (profile, provider) pair with no entry cannot be reserved, so a provider serves
// nothing it has no pairing for: there is no default pairing to fall back to.

const PAIRINGS: ReadonlyMap<string, AiOperationProviderPairing> = new Map(
  (
    [
      [SYNTHETIC_CANARY_LOGICAL_PROFILE, SYNTHETIC_CANARY_OPENAI_PAIRING],
      [REPLY_DRAFTING_V2_LOGICAL_PROFILE, REPLY_DRAFTING_V2_OPENAI_PAIRING],
      [REVIEW_ANALYSIS_V3_LOGICAL_PROFILE, REVIEW_ANALYSIS_V3_OPENAI_PAIRING],
      [REVIEW_ANALYSIS_V3_LOGICAL_PROFILE, REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING],
    ] as const
  ).map(([profile, pairing]) => [
    `${profile.profileVersion}:${pairing.providerId}`,
    pairing,
  ]),
)

export function operationProviderPairing(
  profileVersion: string,
  providerId: AiProviderId,
): AiOperationProviderPairing | null {
  return PAIRINGS.get(`${profileVersion}:${providerId}`) ?? null
}
