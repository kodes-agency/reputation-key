import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { providerRequestProfileOf } from '#/shared/ai-provider-attestations'
import type { AiProviderId } from '#/shared/ai-provider-ids'
import { OPERATOR_PROVIDER_SELECTION } from '#/shared/ai-provider-control/operator-provider-selection'
import type { AiProviderSelectionConfig } from '#/shared/ai-provider-control/provider-selection'
import type { AiOperationProviderLineage } from '../../application/ports/ai-operation-store.port'
import type { AiProviderChoicePort } from '../../application/ports/ai-provider-choice.port'

// Which provider a new review-analysis operation is claimed under: the operator's
// choice (`OPERATOR_PROVIDER_SELECTION`, OpenAI alone), as the identity the operation
// row records and the gateway checks (`provider_profile_changed`). It answers from the
// attestation of the provider this process can call, so a choice that names a provider
// with no adapter here is a wait ("provider_unavailable"), not a claim the gateway
// would refuse after it had reserved budget. No ranking and no fallback: one name, or
// none, and a review waits for it within its horizon.

/** The providers this process has an adapter for, by the identity their attestation gives. */
const CALLABLE_PROVIDERS: Readonly<
  Partial<Record<AiProviderId, AiOperationProviderLineage>>
> = Object.freeze({
  openai: lineageOf('openai', providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1)),
})

function lineageOf(
  providerId: AiProviderId,
  profile: Readonly<{ model: string; version: string; digest: string }>,
): AiOperationProviderLineage {
  return Object.freeze({
    providerId,
    model: profile.model,
    requestProfileVersion: profile.version,
    requestProfileDigest: profile.digest,
  })
}

export function createOperatorProviderChoice(
  selection: AiProviderSelectionConfig = OPERATOR_PROVIDER_SELECTION,
  callable: Readonly<
    Partial<Record<AiProviderId, AiOperationProviderLineage>>
  > = CALLABLE_PROVIDERS,
): AiProviderChoicePort {
  return Object.freeze({
    chooseForReviewAnalysis: async () => {
      const chosen = selection.review_analysis
      if (chosen === undefined) {
        return { status: 'unavailable', code: 'provider_selection_required' } as const
      }
      const lineage = callable[chosen]
      if (lineage === undefined) {
        return { status: 'unavailable', code: 'provider_unavailable' } as const
      }
      return { status: 'chosen', lineage } as const
    },
  })
}
