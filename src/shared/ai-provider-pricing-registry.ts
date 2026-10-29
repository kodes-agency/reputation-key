import type { AiProviderId } from './ai-provider-ids'
import { OPENAI_PRICE_CATALOGUE_V1 } from './ai-openai-provider-profile'
import type { AiProviderPriceCatalogue } from './ai-provider-pricing'

/**
 * The price catalogue of each provider the gateway can settle. A provider with no
 * entry cannot be priced, so nothing it runs can be reserved or settled: the
 * lookup answers null and callers refuse, they do not fall back to another
 * provider's prices. An operation recorded without a provider is a v2 operation,
 * and every v2 operation ran on OpenAI.
 */
export const AI_PROVIDER_PRICE_CATALOGUES: Readonly<
  Partial<Record<AiProviderId, AiProviderPriceCatalogue>>
> = Object.freeze({ openai: OPENAI_PRICE_CATALOGUE_V1 })

export function priceCatalogueOfProvider(
  providerId: string | null,
): AiProviderPriceCatalogue | null {
  const id = providerId ?? 'openai'
  return Object.hasOwn(AI_PROVIDER_PRICE_CATALOGUES, id)
    ? (AI_PROVIDER_PRICE_CATALOGUES[id as AiProviderId] ?? null)
    : null
}
