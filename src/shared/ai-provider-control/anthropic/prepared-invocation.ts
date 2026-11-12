import type { AiAdmissionDescriptorV1 } from '#/shared/ai-internal-transport-contract'
import {
  finalizePreparedProviderInvocation,
  type DerivedDescriptorFacts,
  type PreparedInvocationTraceStage,
} from '../prepared-invocation'
import type { ClosedAnthropicRequest } from './request-builder'

const PREPARED_ANTHROPIC_INVOCATION_BRAND_VALUE = true as const
const preparedAnthropicInvocationBrand: unique symbol = Symbol(
  'PreparedAnthropicInvocation',
)

export type PreparedAnthropicInvocation = Readonly<{
  descriptor: AiAdmissionDescriptorV1
  sdkRequest: ClosedAnthropicRequest
  canonicalProviderBytes: Uint8Array
  [preparedAnthropicInvocationBrand]: true
}>

export function createPreparedAnthropicInvocation(
  input: Readonly<{
    sourceBytes: Uint8Array
    providerPayload: unknown
    sdkRequest: ClosedAnthropicRequest
    createDescriptor: (facts: DerivedDescriptorFacts) => AiAdmissionDescriptorV1
    traceStage?: (stage: PreparedInvocationTraceStage) => void
  }>,
): PreparedAnthropicInvocation {
  return finalizePreparedProviderInvocation({
    ...input,
    providerPayloadContent: input.sdkRequest.messages[0].content,
    payloadMismatchMessage:
      'Closed Anthropic request is not derived from its provider payload',
    derivePromptCacheShard: () => 0,
    validateDescriptor: (descriptor) => {
      if (descriptor.promptCacheShard !== 0) {
        throw new TypeError('Anthropic descriptor prompt cache shard must be zero')
      }
    },
    createInvocation: (descriptor, canonicalProviderBytes) =>
      Object.freeze({
        descriptor,
        sdkRequest: input.sdkRequest,
        canonicalProviderBytes,
        [preparedAnthropicInvocationBrand]: PREPARED_ANTHROPIC_INVOCATION_BRAND_VALUE,
      }),
  })
}
