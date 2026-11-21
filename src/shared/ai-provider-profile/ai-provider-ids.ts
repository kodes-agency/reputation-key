/**
 * The providers a review analysis may be sent to. One vocabulary for the
 * database checks that name a provider (`ai_operations.provider_id`, the
 * `provider` execution-control scope) and for the provider seam that selects
 * one, so neither can admit a provider the other does not know.
 */
export const AI_PROVIDER_IDS = Object.freeze(['openai', 'anthropic'] as const)

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
