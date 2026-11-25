import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { zodTextFormat } from 'openai/helpers/zod'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation/ai-operation-profiles'
import {
  REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA,
  REVIEW_ANALYSIS_V3_STORED_SCHEMA,
} from '#/shared/analysis/review-analysis-v3'
import type { AiAdmissionDescriptorV1 } from '#/shared/ai-gateway/ai-internal-transport-contract'
import { admitForTest } from './execution-admission.test-fixtures'
import { evaluateProviderDispatchGate } from './connector-boundary'
import {
  buildClosedOpenAiRequest,
  createPreparedAiInvocation,
} from './prepared-invocation'
import { createOpenAiConnector } from './openai-connector'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import type { ClosedJsonSchemaFormat } from './contracts'

const PERMIT_ID = '10000000-0000-4000-8000-000000000002'

const connectorOutputSchema = z.object({ ok: z.boolean() }).strict()
const connectorFormat = JSON.parse(
  JSON.stringify(zodTextFormat(connectorOutputSchema, 'canary_result')),
) as ClosedJsonSchemaFormat

function connectorDescriptor(
  derived: Parameters<
    Parameters<typeof createPreparedAiInvocation>[0]['createDescriptor']
  >[0],
): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'synthetic_canary',
    route: 'synthetic-canary',
    operationId: '10000000-0000-4000-8000-000000000001',
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

function createConnectorHarness(
  outboundFetch: typeof fetch,
  format: ClosedJsonSchemaFormat = connectorFormat,
) {
  const sdkRequest = buildClosedOpenAiRequest({
    route: 'synthetic-canary',
    promptVersion: 'synthetic-canary-prompt-v1',
    promptCacheShard: 0,
    developerMessage: 'Return the fixed canary marker.',
    untrustedData: '{"canary":true}',
    format,
    maxOutputTokens: 4_096,
    reasoningEffort: 'low',
    safetyIdentifier: `rk1_${'A'.repeat(43)}`,
  })
  const invocation = createPreparedAiInvocation({
    sourceBytes: Uint8Array.of(1),
    providerPayload: { canary: true },
    sdkRequest,
    createDescriptor: connectorDescriptor,
  })
  const admission = admitForTest(invocation.descriptor, {
    issuedAtEpochMillis: 1_780_000_000_000,
  })
  const connector = createOpenAiConnector({
    apiKey: 'test-key',
    outboundFetch,
    now: () => 1_780_000_001_000,
  })
  return {
    connector,
    invocation,
    admission,
    canonicalBody: Buffer.from(canonicalizeRfc8785(sdkRequest), 'utf8'),
  }
}

function providerResponse(
  input: Readonly<{
    parsed?: unknown
    refusal?: string
    usage?: Readonly<{
      inputTokens: number
      cachedTokens: number
      outputTokens: number
      reasoningTokens: number
      totalTokens: number
    }>
    incomplete?: Readonly<{ reason: string }>
    emptyOutput?: boolean
  }> = {},
): Response {
  const usage = input.usage ?? {
    inputTokens: 10,
    cachedTokens: 2,
    outputTokens: 5,
    reasoningTokens: 1,
    totalTokens: 15,
  }
  const content =
    input.refusal === undefined
      ? [
          {
            type: 'output_text',
            text: JSON.stringify(
              input.parsed === undefined ? { ok: true } : input.parsed,
            ),
            annotations: [],
            logprobs: [],
          },
        ]
      : [{ type: 'refusal', refusal: input.refusal }]
  return new Response(
    JSON.stringify({
      id: 'must-not-escape',
      object: 'response',
      created_at: 1_780_000_000,
      status: input.incomplete === undefined ? 'completed' : 'incomplete',
      error: null,
      incomplete_details: input.incomplete ?? null,
      instructions: null,
      max_output_tokens: 4096,
      model: 'gpt-5.4-mini-2026-03-17',
      output: input.emptyOutput
        ? []
        : [
            {
              id: 'provider-message-id',
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content,
            },
          ],
      parallel_tool_calls: false,
      previous_response_id: null,
      reasoning: { effort: 'xhigh', summary: null },
      service_tier: 'default',
      store: false,
      temperature: null,
      text: { format: { type: 'json_schema' }, verbosity: 'medium' },
      tool_choice: 'auto',
      tools: [],
      top_logprobs: 0,
      top_p: null,
      truncation: 'disabled',
      usage: {
        input_tokens: usage.inputTokens,
        input_tokens_details: { cached_tokens: usage.cachedTokens },
        output_tokens: usage.outputTokens,
        output_tokens_details: { reasoning_tokens: usage.reasoningTokens },
        total_tokens: usage.totalTokens,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function invoke(
  harness: ReturnType<typeof createConnectorHarness>,
  schema: z.ZodType = connectorOutputSchema,
  admission = harness.admission,
) {
  return harness.connector.invoke(
    harness.invocation,
    admission,
    schema,
    new AbortController().signal,
  )
}

describe('official OpenAI SDK connector integration', () => {
  it('passes exact attested bytes through SDK 7.20 and returns parsed output with bounded usage', async () => {
    let expectedBody = Buffer.alloc(0)
    const outbound = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.openai.com/v1/responses')
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(expectedBody)
      return providerResponse()
    })
    const harness = createConnectorHarness(outbound)
    expectedBody = harness.canonicalBody
    const outcome = await invoke(harness)
    expect(outcome).toMatchObject({
      disposition: 'success',
      result: { ok: true },
      usage: {
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 15,
      },
      outboundFetchUsed: true,
    })
    expect(outbound).toHaveBeenCalledTimes(1)
  })

  it('maps official refusal, null output, and invalid usage without releasing output', async () => {
    for (const [responseValue, disposition] of [
      [providerResponse({ refusal: 'not allowed' }), 'provider_refused'],
      [providerResponse({ parsed: null }), 'output_invalid'],
      [
        providerResponse({
          usage: {
            inputTokens: 10,
            cachedTokens: 11,
            outputTokens: 5,
            reasoningTokens: 1,
            totalTokens: 15,
          },
        }),
        'output_invalid',
      ],
    ] as const) {
      const harness = createConnectorHarness(async () => responseValue)
      const outcome = await invoke(harness)
      expect(outcome.disposition).toBe(disposition)
      expect(outcome.result).toBeNull()
    }
  })

  it('keeps the usage of a completed answer that breaks the output schema', async () => {
    // The SDK parses a completed answer with the same zod schema and throws when
    // it fails (a refinement JSON Schema cannot state, say). The call was
    // billed and its usage block was valid; reporting it as unknown settled the
    // call at the reservation ceiling and dropped the token counts.
    const harness = createConnectorHarness(async () => providerResponse({ parsed: null }))
    const outcome = await invoke(harness)
    expect(outcome).toMatchObject({
      disposition: 'output_invalid',
      reportedDisposition: 'success',
      result: null,
      usageKnown: true,
      providerRetryable: false,
      usage: {
        inputTokens: 10,
        cachedTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 15,
      },
    })
  })

  // Structured Outputs cannot enforce "one mention per thing", so the connector
  // parses with the provider answer schema and the normalizer merges repeats; the
  // stored schema would refuse an answer that was already billed.
  it('passes on an analysis answer that mentions one thing twice', async () => {
    const answer = {
      sentiment: 'negative',
      mentions: [
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'clear',
          thing: 'air conditioning',
          issue: 'not working',
          sentences: [1],
          names_person: null,
        },
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'very weak',
          sentences: [2],
          names_person: null,
        },
      ],
      urgent: null,
    }
    const invokeWith = async (schema: z.ZodType) => {
      const harness = createConnectorHarness(
        async () => providerResponse({ parsed: answer }),
        JSON.parse(
          JSON.stringify(zodTextFormat(schema, 'review_analysis_v3')),
        ) as ClosedJsonSchemaFormat,
      )
      return invoke(harness, schema)
    }

    await expect(invokeWith(REVIEW_ANALYSIS_V3_STORED_SCHEMA)).resolves.toMatchObject({
      disposition: 'output_invalid',
      usageKnown: true,
    })
    await expect(
      invokeWith(REVIEW_ANALYSIS_V3_PROVIDER_ANSWER_SCHEMA),
    ).resolves.toMatchObject({
      disposition: 'success',
      result: answer,
    })
  })

  it('still reports unknown usage when the completed answer carries none that adds up', async () => {
    const harness = createConnectorHarness(async () =>
      providerResponse({
        parsed: null,
        usage: {
          inputTokens: 10,
          cachedTokens: 11,
          outputTokens: 5,
          reasoningTokens: 1,
          totalTokens: 15,
        },
      }),
    )
    const outcome = await invoke(harness)
    expect(outcome).toMatchObject({ disposition: 'output_invalid', usageKnown: false })
  })

  it('names a truncated answer output_truncated, not output_invalid', async () => {
    // The distinction is the whole point: a truncated response is a fully-billed
    // provider call that returned nothing, and reporting it as `output_invalid`
    // made it indistinguishable from a malformed answer. That is what hid a
    // global reasoning-effort fault, where every route burned its output budget
    // on reasoning and returned an empty body.
    for (const reason of ['max_output_tokens', 'content_filter'] as const) {
      const harness = createConnectorHarness(async () =>
        providerResponse({ parsed: null, incomplete: { reason } }),
      )
      const outcome = await invoke(harness)
      expect(outcome.disposition).toBe('output_truncated')
      expect(outcome.result).toBeNull()
      // Still billed, still not worth retrying at the same ceiling.
      expect(outcome.usageKnown).toBe(true)
      expect(outcome.providerRetryable).toBe(false)
    }
  })

  it('releases no content from a truncated response that carries valid output text', async () => {
    // My first attempt asserted this returned `success`, on the assumption that a
    // truncated answer which still satisfies the schema is a good answer. It is
    // not reachable: the SDK parses only when `status === 'completed'`
    // (openai/lib/ResponsesParser.js `shouldParse`), so `output_parsed` is null
    // however complete the text looks. The real property is containment - a
    // partial answer never escapes, even when it would have parsed.
    const harness = createConnectorHarness(async () =>
      providerResponse({ incomplete: { reason: 'max_output_tokens' } }),
    )
    const outcome = await invoke(harness)
    expect(outcome.disposition).toBe('output_truncated')
    expect(outcome.result).toBeNull()
  })

  it('still says output_invalid when a completed response yields no parse', async () => {
    // The other arm of the same branch, and the reason it is a ternary rather
    // than an unconditional `output_truncated`. A completed response with an
    // empty output array parses to nothing without the SDK throwing, so it
    // reaches the same code path as a truncated one and must NOT borrow its
    // name: nothing was cut short, the provider simply said nothing.
    const harness = createConnectorHarness(async () =>
      providerResponse({ emptyOutput: true }),
    )
    const outcome = await invoke(harness)
    expect(outcome.disposition).toBe('output_invalid')
    expect(outcome.result).toBeNull()
  })

  it('accepts the exact profile input-token ceiling and rejects one token above it', async () => {
    const profile = AI_OPERATION_PROFILES.find(
      (candidate) => candidate.profileVersion === 'synthetic-canary-v1',
    )
    expect(profile).toBeDefined()
    for (const offset of [0, 1] as const) {
      let ceiling = 0
      const harness = createConnectorHarness(async () =>
        providerResponse({
          usage: {
            inputTokens: ceiling + offset,
            cachedTokens: 0,
            outputTokens: 1,
            reasoningTokens: 0,
            totalTokens: ceiling + offset + 1,
          },
        }),
      )
      ceiling =
        (profile?.staticTokenBearingBytes ?? 0) +
        harness.invocation.descriptor.providerPayloadByteCount
      const outcome = await invoke(harness)
      expect(outcome.disposition).toBe(offset === 0 ? 'success' : 'output_invalid')
      expect(outcome.usage.inputTokens).toBe(offset === 0 ? ceiling : 0)
    }
  })

  it.each([
    [429, 'rate_limited', 17, true],
    [500, 'provider_unavailable', null, true],
    [502, 'provider_unavailable', null, true],
    [503, 'provider_unavailable', null, true],
    [504, 'provider_unavailable', null, true],
    [418, 'provider_refused', null, false],
    [401, 'provider_unavailable', null, false],
    [307, 'provider_unavailable', null, false],
  ])(
    'maps complete status %i without an SDK retry',
    async (status, disposition, retryAfter, usageKnown) => {
      const outbound = vi.fn(
        async () =>
          new Response('poison', {
            status,
            headers: retryAfter === null ? {} : { 'retry-after': String(retryAfter) },
          }),
      )
      const harness = createConnectorHarness(outbound)
      const outcome = await invoke(harness)
      expect(outcome).toMatchObject({
        disposition,
        result: null,
        retryAfterSeconds: retryAfter,
        // A 429 or 5xx bills nothing, and says so: the admission authority
        // charges it zero, and the gateway must expect zero. Any other status
        // keeps unknown usage and stays ambiguous, as before.
        usageKnown,
        usage: {
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
      })
      expect(outbound).toHaveBeenCalledTimes(1)
    },
  )

  // Closed beta, 2026-10-24: the account's credit ran out and every call
  // answered 429. Read as a rate limit, the analyses retried, gave up and
  // stayed unanalysed, with nothing naming the cause.
  it.each([
    ['current', { type: 'insufficient_quota', code: 'credit_balance_exhausted' }],
    ['older', { type: 'requests', code: 'insufficient_quota' }],
  ])(
    'maps a 429 whose %s body says the credit is gone to quota_exhausted',
    async (_label, error) => {
      const outbound = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'no credits', ...error } }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '20' },
          }),
      )
      const harness = createConnectorHarness(outbound)
      const outcome = await invoke(harness)
      expect(outcome).toMatchObject({
        disposition: 'quota_exhausted',
        reportedDisposition: 'quota_exhausted',
        result: null,
        usageKnown: true,
        providerRetryable: false,
        retryAfterSeconds: null,
      })
      expect(outbound).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps a 429 that is a rate limit a retryable rate limit', async () => {
    const outbound = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { type: 'tokens', code: 'rate_limit_exceeded' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '7' },
          },
        ),
    )
    const harness = createConnectorHarness(outbound)
    const outcome = await invoke(harness)
    expect(outcome).toMatchObject({
      disposition: 'rate_limited',
      providerRetryable: true,
      retryAfterSeconds: 7,
    })
  })

  it.each([
    [
      'copy of an admission the authority minted',
      (harness: ReturnType<typeof createConnectorHarness>) => ({
        ...harness.admission,
      }),
    ],
    [
      'admission for another deadline',
      (harness: ReturnType<typeof createConnectorHarness>) =>
        admitForTest(
          {
            ...harness.invocation.descriptor,
            callerDeadlineEpochMillis:
              harness.invocation.descriptor.callerDeadlineEpochMillis - 1,
          },
          { issuedAtEpochMillis: 1_780_000_000_000 },
        ),
    ],
  ])('returns no-dispatch and zeroes bytes for a %s', async (_label, mutateAdmission) => {
    const outbound = vi.fn(async () => providerResponse())
    const harness = createConnectorHarness(outbound)
    const outcome = await invoke(harness, connectorOutputSchema, mutateAdmission(harness))
    expect(outcome.disposition).toBe('no_dispatch')
    expect(outbound).not.toHaveBeenCalled()
    expect(harness.invocation.canonicalProviderBytes.every((byte) => byte === 0)).toBe(
      true,
    )
  })

  it('rejects a same-length mutation of the actual outbound byte buffer', async () => {
    const outbound = vi.fn(async () => providerResponse())
    const harness = createConnectorHarness(outbound)
    const sentinelOffset = harness.invocation.canonicalProviderBytes.indexOf(
      'safe'.charCodeAt(0),
    )
    expect(sentinelOffset).toBeGreaterThanOrEqual(0)
    harness.invocation.canonicalProviderBytes[sentinelOffset] = 'f'.charCodeAt(0)
    const outcome = await invoke(harness)
    expect(outcome.disposition).toBe('no_dispatch')
    expect(outbound).not.toHaveBeenCalled()
    expect(harness.invocation.canonicalProviderBytes.every((byte) => byte === 0)).toBe(
      true,
    )
  })

  it('makes zero requests for an admission of another permit, one after a transport failure, and none when the same admission is used again', async () => {
    const deniedOutbound = vi.fn(async () => providerResponse())
    const denied = createConnectorHarness(deniedOutbound)
    const mutated = admitForTest(
      {
        ...denied.invocation.descriptor,
        permitId: '10000000-0000-4000-8000-0000000000ff',
      },
      { issuedAtEpochMillis: 1_780_000_000_000 },
    )
    const deniedOutcome = await invoke(denied, connectorOutputSchema, mutated)
    expect(deniedOutcome.disposition).toBe('no_dispatch')
    expect(deniedOutbound).not.toHaveBeenCalled()

    const ambiguousOutbound = vi.fn(async () => {
      throw new Error('connection reset')
    })
    const ambiguous = createConnectorHarness(ambiguousOutbound)
    const pristineBytes = Uint8Array.from(ambiguous.invocation.canonicalProviderBytes)
    const ambiguousOutcome = await invoke(ambiguous)
    expect(ambiguousOutcome.disposition).toBe('transport_ambiguous')
    expect(ambiguousOutbound).toHaveBeenCalledTimes(1)

    // The first call zeroed the bytes; present the identical, valid bytes again so
    // only the spent admission can be the reason for the refusal.
    ambiguous.invocation.canonicalProviderBytes.set(pristineBytes)
    expect(
      evaluateProviderDispatchGate({
        invocation: ambiguous.invocation,
        admission: ambiguous.admission,
        currentTime: 1_780_000_001_000,
      }).reasons,
    ).toEqual(['admission_already_used'])
    ambiguous.invocation.canonicalProviderBytes.set(pristineBytes)
    const reused = await invoke(ambiguous)
    expect(reused.disposition).toBe('no_dispatch')
    expect(ambiguousOutbound).toHaveBeenCalledTimes(1)
  })
})
