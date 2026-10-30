import type { AiOperationProviderLineage } from './ai-operation-store.port'

/**
 * Which provider a new review-analysis operation is claimed under (contract
 * sections 7.1 and 7.3). The operator names the provider and nothing else does:
 * there is no ranking of two and no per-call fallback. The answer is the identity
 * the operation row will record, from the same attestation the gateway serves it
 * with, so the gateway can refuse an operation whose provider was re-attested
 * since (`provider_profile_changed`). The AI context never sees an adapter.
 */
export type AiProviderChoicePort = Readonly<{
  chooseForReviewAnalysis(): Promise<
    | Readonly<{ status: 'chosen'; lineage: AiOperationProviderLineage }>
    /**
     * No provider can take the call now, or the operator has not chosen one: a
     * wait, not a verdict on the review. `code` is closed and content-free.
     */
    | Readonly<{
        status: 'unavailable'
        code: 'provider_unavailable' | 'provider_selection_required'
      }>
  >
}>
