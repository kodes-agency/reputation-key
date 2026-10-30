import { z } from 'zod/v4'
import { zodTextFormat } from 'openai/helpers/zod'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { providerRequestProfileOf } from '#/shared/ai-provider-attestations'
import { OPENAI_PRICE_CATALOGUE_V2 } from '#/shared/ai-openai-provider-profile'
import {
  OPENAI_PROMPT_VERSIONS,
  type ClosedJsonSchemaFormat,
  type OpenAiConnector,
} from './contracts'
import {
  buildClosedOpenAiRequest,
  computePromptCacheShard,
  createPreparedAiInvocation,
  type PreparedAiInvocation,
} from './prepared-invocation'
import type {
  AiProviderAdapter,
  AiProviderPreparation,
  LogicalAiInvocation,
  PrepareProviderInvocationInput,
} from './provider-contracts'

// OpenAI behind the provider seam. Nothing here is new behaviour: `prepare` is the
// request building the route preparer used to do inline (the same functions, in the
// same order), and `invoke` is the connector, unchanged. What the seam adds is that
// the gateway reaches both through the one interface a second provider implements.

const closedJsonSchemaFormatSchema = z
  .object({
    type: z.literal('json_schema'),
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    strict: z.literal(true),
    schema: z.record(z.string(), z.unknown()),
  })
  .strict()

/** The `text.format` of the Responses API for a logical invocation's answer schema. */
function closedFormatFor(logical: LogicalAiInvocation): ClosedJsonSchemaFormat {
  return closedJsonSchemaFormatSchema.parse(
    JSON.parse(
      JSON.stringify(zodTextFormat(logical.outputSchema, logical.outputSchemaName)),
    ),
  )
}

function prepareOpenAiInvocation(
  input: PrepareProviderInvocationInput,
): PreparedAiInvocation {
  const { logical } = input
  const promptVersion = OPENAI_PROMPT_VERSIONS[logical.route]
  const sdkRequest = buildClosedOpenAiRequest({
    route: logical.route,
    promptVersion,
    promptCacheShard: computePromptCacheShard({
      operationId: logical.operationId,
      route: logical.route,
      promptVersion,
    }),
    developerMessage: logical.developerPrompt,
    untrustedData: logical.untrustedData,
    format: closedFormatFor(logical),
    maxOutputTokens: logical.maxOutputTokens,
    reasoningEffort: logical.reasoningEffort,
    safetyIdentifier: logical.safetyIdentifier,
  })
  return createPreparedAiInvocation({
    sourceBytes: input.sourceBytes,
    providerPayload: input.providerPayload,
    sdkRequest,
    createDescriptor: input.createDescriptor,
    requestBindingKeys: input.requestBindingKeys,
  })
}

/** OpenAI's request building, which reads no credential. */
export function createOpenAiProviderPreparation(): AiProviderPreparation<PreparedAiInvocation> {
  return Object.freeze({
    providerId: 'openai',
    requestProfile: providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1),
    pricing: OPENAI_PRICE_CATALOGUE_V2,
    prepare: prepareOpenAiInvocation,
  })
}

/** OpenAI's request building and its one connector, as the seam's adapter. */
export function createOpenAiProviderAdapter(
  connector: OpenAiConnector,
): AiProviderAdapter<PreparedAiInvocation> {
  return Object.freeze({
    ...createOpenAiProviderPreparation(),
    invoke: (invocation, grant, outputSchema, signal) =>
      connector.invoke(invocation, grant, outputSchema, signal),
    readiness: () => connector.readiness?.() ?? true,
    close: () => connector.close?.(),
    destroy: () => connector.destroy?.(),
  })
}
