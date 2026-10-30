import type { AiProviderId } from './ai-provider-ids'
import { OPENAI_PRICE_CATALOGUE_V1 } from './ai-openai-provider-profile'
import { ANTHROPIC_PRICE_CATALOGUE_V1 } from './ai-provider-control/anthropic/request-profile'
import type { AiProviderPriceCatalogue } from './ai-provider-pricing'

/**
 * The price catalogue of each provider the gateway can settle. A provider with no
 * entry cannot be priced, so nothing it runs can be reserved or settled: the
 * lookup answers null and callers refuse, they do not fall back to another
 * provider's prices. An operation recorded without a provider is a v2 operation,
 * and every v2 operation ran on OpenAI.
 */
const providerPriceCatalogues: Partial<Record<AiProviderId, AiProviderPriceCatalogue>> = {
  openai: OPENAI_PRICE_CATALOGUE_V1,
}

// Keep the live v2 catalogue's enumerable surface byte-for-byte stable while the
// Anthropic adapter is dark. Lookup still sees this own property; activation can
// make it enumerable when the runtime envelope names Anthropic.
Object.defineProperty(providerPriceCatalogues, 'anthropic', {
  value: ANTHROPIC_PRICE_CATALOGUE_V1,
  enumerable: false,
  configurable: false,
  writable: false,
})

export const AI_PROVIDER_PRICE_CATALOGUES: Readonly<
  Partial<Record<AiProviderId, AiProviderPriceCatalogue>>
> = Object.freeze(providerPriceCatalogues)

export function priceCatalogueOfProvider(
  providerId: string | null,
): AiProviderPriceCatalogue | null {
  const id = providerId ?? 'openai'
  return Object.hasOwn(AI_PROVIDER_PRICE_CATALOGUES, id)
    ? (AI_PROVIDER_PRICE_CATALOGUES[id as AiProviderId] ?? null)
    : null
}
