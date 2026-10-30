import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENAI_PROVIDER_ATTESTATION_V1 } from '#/shared/ai-openai-provider-attestation'
import { OPENAI_PRICE_CATALOGUE_V2 } from '#/shared/ai-openai-provider-profile'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { analysisRequest } from '#/shared/ai-gateway-transport-contract.test-fixtures'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import { providerRequestProfileOf } from '#/shared/ai-provider-attestations'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import type { OpenAiConnector, OpenAiConnectorOutcome } from './contracts'
import { evidencePreparer, openAiRequestOf } from './review-evidence.test-fixtures'
import {
  createOpenAiProviderAdapter,
  createOpenAiProviderPreparation,
} from './openai-provider-adapter'
import { computePromptCacheShard, type PreparedAiInvocation } from './prepared-invocation'
import type {
  AiProviderConnection,
  PrepareProviderInvocationInput,
} from './provider-contracts'
import { createAiProviderRegistry } from './provider-selection'

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const outcome: OpenAiConnectorOutcome<unknown> = Object.freeze({
  disposition: 'success',
  reportedDisposition: 'success',
  result: { accepted: true },
  usageKnown: true,
  providerRetryable: false,
  usage: Object.freeze({
    inputTokens: 10,
    cachedTokens: 4,
    outputTokens: 2,
    reasoningTokens: 1,
    totalTokens: 12,
  }),
  retryAfterSeconds: null,
  outboundFetchUsed: true,
})

describe('OpenAI behind the provider seam', () => {
  it('is OpenAI as its attestation says, priced by its own list', () => {
    const preparation = createOpenAiProviderPreparation()

    expect(preparation.providerId).toBe('openai')
    expect(preparation.requestProfile).toEqual(
      providerRequestProfileOf(OPENAI_PROVIDER_ATTESTATION_V1),
    )
    expect(preparation.requestProfile.model).toBe('gpt-6-luna')
    expect(preparation.pricing).toBe(OPENAI_PRICE_CATALOGUE_V2)
    expect(Object.isFrozen(preparation)).toBe(true)
  })

  it('makes the call through the connector it is given, with the arguments it got', async () => {
    const invoke = vi.fn(async () => outcome)
    const connector = { invoke } as unknown as OpenAiConnector
    const adapter = createOpenAiProviderAdapter(connector)
    const args = [
      { marker: 'invocation' },
      { marker: 'grant' },
      { marker: 'schema' },
      new AbortController().signal,
    ] as unknown as Parameters<AiProviderConnection<PreparedAiInvocation>['invoke']>

    const result = await adapter.invoke(...args)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(...args)
    expect(result).toBe(outcome)
  })

  it('lets a failed call fail exactly as the connector failed it', async () => {
    const failure = new Error('connector failed')
    const adapter = createOpenAiProviderAdapter({
      invoke: async () => {
        throw failure
      },
    } as unknown as OpenAiConnector)

    await expect(
      adapter.invoke({} as never, {} as never, {} as never, new AbortController().signal),
    ).rejects.toBe(failure)
  })

  it('is ready unless its connector says it is not, and passes closing through', async () => {
    const close = vi.fn()
    const destroy = vi.fn()
    const silent = createOpenAiProviderAdapter({
      invoke: vi.fn(),
    } as unknown as OpenAiConnector)
    const unready = createOpenAiProviderAdapter({
      invoke: vi.fn(),
      readiness: () => false,
      close,
      destroy,
    } as unknown as OpenAiConnector)

    expect(silent.readiness?.()).toBe(true)
    expect(unready.readiness?.()).toBe(false)
    await unready.close?.()
    unready.destroy?.()
    expect(close).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(() => silent.destroy?.()).not.toThrow()
  })

  it('shapes the request exactly as the preparer shaped it before the seam', () => {
    // Record what the preparer hands the adapter for a real v2 request, then ask the
    // adapter for the same thing a second time: the bytes must be the same bytes.
    const recorded: PrepareProviderInvocationInput[] = []
    const inner = createOpenAiProviderPreparation()
    const recording = {
      ...inner,
      prepare: (input: PrepareProviderInvocationInput) => {
        recorded.push({ ...input, sourceBytes: Uint8Array.from(input.sourceBytes) })
        return inner.prepare(input)
      },
    }
    const request = parseAiGatewayRouteRequest({
      ...analysisRequest(),
      binding: {
        ...analysisRequest().binding,
        languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      },
    })

    const prepared = evidencePreparer({
      providers: createAiProviderRegistry([recording]),
    }).prepare(request)
    const first = recorded[0]!
    const again = inner.prepare({
      ...first,
      sourceBytes: Uint8Array.from(first.sourceBytes),
    })

    expect(recorded).toHaveLength(1)
    expect(Buffer.from(again.canonicalProviderBytes)).toEqual(
      Buffer.from(prepared.invocation.canonicalProviderBytes),
    )
    expect(again.sdkRequest).toEqual(openAiRequestOf(prepared))
    expect(again.descriptor.preparedDigest).toBe(
      prepared.invocation.descriptor.preparedDigest,
    )
    expect(again.requestBindingHmac).toBe(prepared.invocation.requestBindingHmac)
    expect(prepared.providerId).toBe('openai')
  })

  it('puts the logical invocation into the request and nothing else of the review', () => {
    const recorded: PrepareProviderInvocationInput[] = []
    const inner = createOpenAiProviderPreparation()
    const request = parseAiGatewayRouteRequest({
      ...analysisRequest(),
      binding: {
        ...analysisRequest().binding,
        languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      },
    })
    const prepared = evidencePreparer({
      providers: createAiProviderRegistry([
        {
          ...inner,
          prepare: (input: PrepareProviderInvocationInput) => {
            recorded.push(input)
            return inner.prepare(input)
          },
        },
      ]),
    }).prepare(request)
    const { logical } = recorded[0]!
    const sdkRequest = openAiRequestOf(prepared)

    expect(sdkRequest).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      stream: false,
      background: false,
      tools: [],
      truncation: 'disabled',
      service_tier: 'default',
      max_output_tokens: logical.maxOutputTokens,
      reasoning: { effort: logical.reasoningEffort },
      safety_identifier: logical.safetyIdentifier,
      prompt_cache_key: `rk:review-analysis:review-analysis-prompt-v1:${computePromptCacheShard(
        {
          operationId: logical.operationId,
          route: 'review-analysis',
          promptVersion: 'review-analysis-prompt-v1',
        },
      )
        .toString(16)
        .padStart(2, '0')}`,
    })
    expect(sdkRequest.input[0].content).toBe(logical.developerPrompt)
    expect(sdkRequest.input[1].content).toBe(logical.untrustedData)
    expect(sdkRequest.text.format.name).toBe(logical.outputSchemaName)
  })
})
