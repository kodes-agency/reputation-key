// The two cost formulas every provider shares, over a price catalogue the
// provider's attestation pins. Admission reserves with `maximumCostMicrosWith`,
// the gateway and the admission authority settle with `settledCostMicrosWith`,
// and all three must read the same catalogue for the same operation or a receipt
// the authority signed will not bind in the gateway (the 2026-08 repricing
// incident recorded in `ai-openai-provider-profile.ts`). A catalogue holds
// integers only: micro-currency per `unitTokens` tokens.

export type AiProviderPriceCatalogue = Readonly<{
  catalogueId: string
  modelSnapshot: string
  serviceTier?: string
  unitTokens: number
  uncachedInputMicros: number
  cachedInputMicros: number
  outputMicros: number
  sourceUrl: string
  retrievalDate: string
}>

export type AiMaximumCostProfileV1 = Readonly<{
  staticTokenBearingBytes: number
  maxOutputTokens: number
}>

export type AiSettledUsageV1 = Readonly<{
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}>

/**
 * The most an operation can cost: every byte of the static request and of the
 * payload read as an uncached input token, and the whole output budget used.
 */
export function maximumCostMicrosWith(
  catalogue: AiProviderPriceCatalogue,
  profile: AiMaximumCostProfileV1,
  providerPayloadBytes: number,
): number {
  if (
    !Number.isSafeInteger(profile.staticTokenBearingBytes) ||
    profile.staticTokenBearingBytes < 0 ||
    !Number.isSafeInteger(profile.maxOutputTokens) ||
    profile.maxOutputTokens < 0 ||
    !Number.isSafeInteger(providerPayloadBytes) ||
    providerPayloadBytes < 0
  ) {
    throw new RangeError('AI maximum cost inputs must be nonnegative safe integers')
  }

  const unitTokens = BigInt(catalogue.unitTokens)
  const inputTokens =
    BigInt(profile.staticTokenBearingBytes) + BigInt(providerPayloadBytes)
  const numerator =
    inputTokens * BigInt(catalogue.uncachedInputMicros) +
    BigInt(profile.maxOutputTokens) * BigInt(catalogue.outputMicros)
  const result = (numerator + unitTokens - 1n) / unitTokens
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('AI maximum cost exceeds the safe integer range')
  }
  return Number(result)
}

/**
 * What a settled call cost. Ceiling division, matching the settlement ledger:
 * partial micros are charged, never dropped.
 */
export function settledCostMicrosWith(
  catalogue: AiProviderPriceCatalogue,
  usage: AiSettledUsageV1,
): bigint {
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.cachedInputTokens) ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.cachedInputTokens < 0 ||
    usage.outputTokens < 0 ||
    usage.cachedInputTokens > usage.inputTokens
  ) {
    throw new RangeError('AI settled usage must be nonnegative safe integers')
  }
  const unitTokens = BigInt(catalogue.unitTokens)
  const numerator =
    BigInt(usage.inputTokens - usage.cachedInputTokens) *
      BigInt(catalogue.uncachedInputMicros) +
    BigInt(usage.cachedInputTokens) * BigInt(catalogue.cachedInputMicros) +
    BigInt(usage.outputTokens) * BigInt(catalogue.outputMicros)
  return (numerator + unitTokens - 1n) / unitTokens
}
