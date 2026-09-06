import { createHash } from 'node:crypto'
import { OPENAI_MODEL_SNAPSHOT } from '#/shared/ai-openai-request-contract'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  verifyAiRequestBinding,
  type AiAdmissionDescriptorV1,
} from '#/shared/ai-internal-transport-contract'
import {
  buildClosedOpenAiRequest,
  computePromptCacheShard,
  createPreparedAiInvocation,
  deriveOpenAiClientRequestId,
} from './prepared-invocation'

const OPERATION_ID = '10000000-0000-4000-8000-000000000001'
const PERMIT_ID = '10000000-0000-4000-8000-000000000002'
const SHA = 'a'.repeat(64)

function descriptor(
  derived: Parameters<
    Parameters<typeof createPreparedAiInvocation>[0]['createDescriptor']
  >[0],
): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'synthetic_canary',
    route: 'synthetic-canary',
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
    attemptNumber: 1,
    organizationId: null,
    propertyId: null,
    internalSubjectId: null,
    actorId: null,
    binding: null,
    canaryBinding: {
      canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
      canaryAuthorizationGeneration: 1,
      releaseSha: 'b'.repeat(40),
      canaryProfileVersion: 'synthetic-canary-v1',
      safetyIdentifierProfileVersion: 'synthetic-canary-safety-v1',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'synthetic-canary-v1',
      stopFence: {
        globalControlId: '10000000-0000-4000-8000-000000000004',
        globalGeneration: 1,
        providerControlId: '10000000-0000-4000-8000-000000000005',
        providerGeneration: 1,
        allCapabilityStopFences: [
          {
            capability: 'review_analysis',
            capabilityControlId: '10000000-0000-4000-8000-000000000006',
            capabilityGeneration: 1,
          },
          {
            capability: 'reply_drafting',
            capabilityControlId: '10000000-0000-4000-8000-000000000007',
            capabilityGeneration: 1,
          },
          {
            capability: 'property_trends',
            capabilityControlId: '10000000-0000-4000-8000-000000000008',
            capabilityGeneration: 1,
          },
        ],
      },
    },
    releaseSha: 'b'.repeat(40),
    canaryAuthorizationId: '10000000-0000-4000-8000-000000000003',
    ...derived,
    limits: {
      sourceBytes: 16_384,
      providerPayloadBytes: 16_384,
      preparedRequestBytes: 65_536,
      responseBytes: 131_072,
      outputTokens: 4_096,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: 1_780_000_070_000,
    observedContentExpiresAtEpochMillis: null,
    redactionCountry: null,
    redactionProfileVersion: null,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

const format = {
  type: 'json_schema' as const,
  name: 'canary_result',
  strict: true as const,
  schema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  },
}

describe('prepared AI invocation', () => {
  it('pins cache shards and diagnostic request IDs to canonical UUID bytes', () => {
    expect(
      computePromptCacheShard({
        operationId: OPERATION_ID,
        route: 'review-analysis',
        promptVersion: 'review-analysis-prompt-v1',
      }),
    ).toBeGreaterThanOrEqual(0)
    expect(
      computePromptCacheShard({
        operationId: OPERATION_ID,
        route: 'review-analysis',
        promptVersion: 'review-analysis-prompt-v1',
      }),
    ).toBeLessThan(16)
    const expected = `rk_ai_${createHash('sha256')
      .update('repkey-openai-client-request-id-v1\0')
      .update(Buffer.from(PERMIT_ID.replaceAll('-', ''), 'hex'))
      .digest('base64url')}`
    expect(deriveOpenAiClientRequestId(PERMIT_ID)).toBe(expected)
    expect(expected).toHaveLength(49)
  })

  it('constructs source -> request -> descriptor -> HMAC without key-dependent prepared bytes', () => {
    const sdkRequest = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'Fixed developer instruction.',
      untrustedData: '{"canary":true}',
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    const stages: string[] = []
    const firstKeys = createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`)
    const first = createPreparedAiInvocation({
      sourceBytes: Uint8Array.of(1, 2, 3),
      providerPayload: { canary: true },
      sdkRequest,
      createDescriptor: descriptor,
      requestBindingKeys: firstKeys,
      traceStage: (stage) => stages.push(stage),
    })
    const second = createPreparedAiInvocation({
      sourceBytes: Uint8Array.of(1, 2, 3),
      providerPayload: { canary: true },
      sdkRequest,
      createDescriptor: descriptor,
      requestBindingKeys: createVersionedHmacKeyring(`request-v2:${'22'.repeat(32)}`),
    })
    expect(stages).toEqual([
      'source',
      'provider_payload',
      'prepared_request',
      'descriptor',
      'request_binding',
    ])
    expect(first.descriptor.preparedDigest).toBe(second.descriptor.preparedDigest)
    expect(first.canonicalProviderBytes).toEqual(second.canonicalProviderBytes)
    expect(first.requestBindingHmac).not.toBe(second.requestBindingHmac)
    expect(
      verifyAiRequestBinding(
        {
          descriptor: first.descriptor,
          requestBindingKeyId: first.requestBindingKeyId,
          requestBindingHmac: first.requestBindingHmac,
        },
        firstKeys,
      ),
    ).toBe(true)
  })

  it('rejects accessors, undefined, and a descriptor mutation after preparation', () => {
    const sdkRequest = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'Fixed.',
      untrustedData: '{}',
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: {
          get unsafe() {
            return 'x'
          },
        },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(new TypeError('Prepared AI value has an unsafe property: unsafe'))
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { unsafe: undefined },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(new TypeError('Prepared AI value has an unsupported property: unsafe'))
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: {},
        sdkRequest,
        createDescriptor: (facts) => descriptor({ ...facts, preparedDigest: SHA }),
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(
      new TypeError('Prepared AI descriptor changed derived field: preparedDigest'),
    )
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { different: true },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/not derived/)
  })

  it('rejects sparse arrays and non-index array properties before canonicalization', () => {
    const sdkRequest = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'Fixed.',
      untrustedData: '{}',
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    const sparse: unknown[] = []
    sparse.length = 1
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { values: sparse },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/array/)
    const extra = [1] as number[] & { extra?: string }
    extra.extra = 'ignored-by-json'
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { values: extra },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/array/)
  })

  it('rejects custom array prototypes, iterators, and inherited method traps without invoking them', () => {
    const sdkRequest = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'Fixed.',
      untrustedData: '{}',
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    let invoked = false
    const hostile = [1]
    Object.setPrototypeOf(hostile, {
      map() {
        invoked = true
        throw new Error('method trap')
      },
      some() {
        invoked = true
        throw new Error('method trap')
      },
      [Symbol.iterator]() {
        invoked = true
        throw new Error('iterator trap')
      },
    })
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { values: hostile },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/prototype/)
    expect(invoked).toBe(false)

    const ownIterator = [1] as unknown[] & { [Symbol.iterator]: () => never }
    ownIterator[Symbol.iterator] = () => {
      invoked = true
      throw new Error('iterator trap')
    }
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: { values: ownIterator },
        sdkRequest,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/symbol/)
    expect(invoked).toBe(false)
  })

  it.each(['descriptor', 'signing'] as const)(
    'zeroes allocated canonical request bytes when %s fails',
    (failure) => {
      const sdkRequest = buildClosedOpenAiRequest({
        route: 'synthetic-canary',
        promptVersion: 'synthetic-canary-prompt-v1',
        promptCacheShard: 0,
        developerMessage: 'Fixed.',
        untrustedData: '{}',
        format,
        maxOutputTokens: 4_096,
        reasoningEffort: 'low',
        safetyIdentifier: `rk1_${'A'.repeat(43)}`,
      })
      const realFrom = Buffer.from.bind(Buffer)
      const captured: Buffer[] = []
      const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((
        value: unknown,
        ...args: unknown[]
      ) => {
        const result = Reflect.apply(realFrom, Buffer, [value, ...args]) as Buffer
        // Derived, not pinned: a hardcoded model id silently stops matching on a model
        // switch and the assertion below then passes vacuously on an empty capture.
        if (typeof value === 'string' && value.includes(`"${OPENAI_MODEL_SNAPSHOT}"`)) {
          captured.push(result)
        }
        return result
      }) as typeof Buffer.from)
      try {
        const keys: VersionedHmacKeyring =
          failure === 'signing'
            ? {
                activeVersion: 'v1',
                retainedVersions: [],
                sign: () => {
                  throw new Error('signing failed')
                },
                verify: () => false,
                derive: () => null,
                dispose: () => {},
              }
            : createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`)
        expect(() =>
          createPreparedAiInvocation({
            sourceBytes: Uint8Array.of(1),
            providerPayload: {},
            sdkRequest,
            createDescriptor:
              failure === 'descriptor'
                ? () => {
                    throw new Error('descriptor failed')
                  }
                : descriptor,
            requestBindingKeys: keys,
          }),
        ).toThrow(`${failure} failed`)
        expect(captured.length).toBeGreaterThan(0)
        expect(captured.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
      } finally {
        fromSpy.mockRestore()
      }
    },
  )

  it('rejects every route byte cap before creating a request-binding HMAC', () => {
    const sign = vi.fn<VersionedHmacKeyring['sign']>(() => {
      throw new Error('request binding must not be reached')
    })
    const keys: VersionedHmacKeyring = {
      activeVersion: 'v1',
      retainedVersions: [],
      sign,
      verify: () => false,
      derive: () => null,
      dispose: () => {},
    }
    const providerPayload = { reviewText: 'expanded-redaction'.repeat(8) }
    const providerJson = JSON.stringify(providerPayload)
    const sdkRequest = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'A deliberately expanded schema and prompt boundary.',
      untrustedData: providerJson,
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })

    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: new Uint8Array(17),
        providerPayload,
        sdkRequest,
        createDescriptor: (facts) => ({
          ...descriptor(facts),
          limits: { ...descriptor(facts).limits, sourceBytes: 16 },
        }),
        requestBindingKeys: keys,
      }),
    ).toThrow(/route profile limits|exceeds its limit/)

    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload,
        sdkRequest,
        createDescriptor: (facts) => ({
          ...descriptor(facts),
          limits: {
            ...descriptor(facts).limits,
            providerPayloadBytes: facts.providerPayloadByteCount - 1,
          },
        }),
        requestBindingKeys: keys,
      }),
    ).toThrow(/route profile limits|exceeds its limit/)

    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload,
        sdkRequest,
        createDescriptor: (facts) => ({
          ...descriptor(facts),
          limits: {
            ...descriptor(facts).limits,
            preparedRequestBytes: facts.preparedByteCount - 1,
          },
        }),
        requestBindingKeys: keys,
      }),
    ).toThrow(/route profile limits|exceeds its limit/)
    expect(sign).not.toHaveBeenCalled()
  })

  it('rejects non-hex shards and prompt versions outside the frozen route map', () => {
    expect(() =>
      buildClosedOpenAiRequest({
        route: 'synthetic-canary',
        promptVersion: 'different-prompt-v1',
        promptCacheShard: 0,
        developerMessage: 'Fixed.',
        untrustedData: '{}',
        format,
        maxOutputTokens: 4_096,
        reasoningEffort: 'low',
        safetyIdentifier: `rk1_${'A'.repeat(43)}`,
      }),
    ).toThrow(/Invalid closed OpenAI request input/)

    const valid = buildClosedOpenAiRequest({
      route: 'synthetic-canary',
      promptVersion: 'synthetic-canary-prompt-v1',
      promptCacheShard: 0,
      developerMessage: 'Fixed.',
      untrustedData: '{}',
      format,
      maxOutputTokens: 4_096,
      reasoningEffort: 'low',
      safetyIdentifier: `rk1_${'A'.repeat(43)}`,
    })
    const mutated = {
      ...valid,
      prompt_cache_key: 'rk:synthetic-canary:synthetic-canary-prompt-v1:0_',
    }
    expect(() =>
      createPreparedAiInvocation({
        sourceBytes: Uint8Array.of(1),
        providerPayload: {},
        sdkRequest: mutated,
        createDescriptor: descriptor,
        requestBindingKeys: createVersionedHmacKeyring(`v1:${'11'.repeat(32)}`),
      }),
    ).toThrow(/cache key is invalid/)
  })
})
