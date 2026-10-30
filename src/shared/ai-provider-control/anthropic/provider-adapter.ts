import { z } from 'zod/v4'
import { providerRequestProfileOf } from '#/shared/ai-provider-attestations'
import type {
  AiProviderAdapter,
  AiProviderConnection,
  AiProviderPreparation,
  PrepareProviderInvocationInput,
} from '../provider-contracts'
import { ANTHROPIC_PROVIDER_ATTESTATION_V1 } from './attestation'
import {
  createPreparedAnthropicInvocation,
  type PreparedAnthropicInvocation,
} from './prepared-invocation'
import { buildClosedAnthropicRequest } from './request-builder'
import { ANTHROPIC_PRICE_CATALOGUE_V1 } from './request-profile'
import { anthropicWireSchemaOf } from './schema-transform'

function prepareAnthropicInvocation(
  input: PrepareProviderInvocationInput,
): PreparedAnthropicInvocation {
  const { logical } = input
  const generated = z.toJSONSchema(logical.outputSchema, { target: 'draft-7' })
  const wireSchema = anthropicWireSchemaOf(generated)
  const sdkRequest = buildClosedAnthropicRequest({
    developerPrompt: logical.developerPrompt,
    untrustedData: logical.untrustedData,
    wireSchema,
    maxOutputTokens: logical.maxOutputTokens,
    reasoningEffort: logical.reasoningEffort,
    safetyIdentifier: logical.safetyIdentifier,
  })
  return createPreparedAnthropicInvocation({
    sourceBytes: input.sourceBytes,
    providerPayload: input.providerPayload,
    sdkRequest,
    createDescriptor: input.createDescriptor,
    requestBindingKeys: input.requestBindingKeys,
  })
}

export function createAnthropicProviderPreparation(): AiProviderPreparation<PreparedAnthropicInvocation> {
  return Object.freeze({
    providerId: 'anthropic',
    requestProfile: providerRequestProfileOf(ANTHROPIC_PROVIDER_ATTESTATION_V1),
    pricing: ANTHROPIC_PRICE_CATALOGUE_V1,
    prepare: prepareAnthropicInvocation,
  })
}

export function createAnthropicProviderAdapter(
  connector: AiProviderConnection<PreparedAnthropicInvocation>,
): AiProviderAdapter<PreparedAnthropicInvocation> {
  return Object.freeze({
    ...createAnthropicProviderPreparation(),
    invoke: (invocation, grant, outputSchema, signal) =>
      connector.invoke(invocation, grant, outputSchema, signal),
    readiness: () => connector.readiness?.() ?? true,
    close: () => connector.close?.(),
    destroy: () => connector.destroy?.(),
  })
}
