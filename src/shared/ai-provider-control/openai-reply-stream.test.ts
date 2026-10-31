import OpenAI from 'openai'
import { readOpenAiReplyStream } from './openai-stream-response'
import { openAiRequestOf } from './review-evidence.test-fixtures'
import { replyDraftingV2OutputSchema } from '#/shared/reply-drafting-v2-schema'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createAiEgressGatewayService } from './service'
import { createOpenAiConnector } from './openai-connector'
import { createAiGatewayRoutePreparer } from './route-preparer'
import { createSensitiveSourceLease } from './source-lease'
import { replyV2Request } from './reply-drafting-v2.test-fixtures'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  signAiExecutionGrant,
  signAiSettlementReceipt,
} from '#/shared/ai-internal-transport-contract'
import { settledCostMicros } from '#/shared/ai-openai-provider-profile'
import { boundedProviderEventStream } from './bounded-event-stream'
import {
  OPENAI_REPLY_STREAM_ATTESTATION,
  OPENAI_REPLY_STREAM_SHAPE_DIGEST,
  REPLY_STREAM_DEPLOYMENT,
} from '#/shared/ai-openai-stream-profile'
import type { ReplyDraftingProgress } from '#/shared/reply-drafting-progress'

const NOW = 1_780_000_000_000
const KEYS = generateKeyPairSync('ed25519')
const REQUEST_KEYS = createVersionedHmacKeyring(`request-v1:${'07'.repeat(32)}`)
const OUTPUT = {
  languageCode: 'en-Latn',
  case: 'complaint',
  mainPoint: [1],
  avoidTerms: [],
  replyText:
    'We are sorry the wait took so long. Your time should have been treated with more care.',
}
type Mode =
  | 'success'
  | 'invalid'
  | 'truncated'
  | 'refused'
  | 'missing_terminal'
  | 'disconnect'
  | 'trailing_invalid'
  | 'malformed_terminal'

function events(mode: Mode) {
  const text = mode === 'invalid' ? '{malformed' : JSON.stringify(OUTPUT)
  const terminal = {
    id: 'resp_test',
    object: 'response',
    status: mode === 'truncated' ? 'incomplete' : 'completed',
    incomplete_details: mode === 'truncated' ? { reason: 'max_output_tokens' } : null,
    output:
      mode === 'malformed_terminal'
        ? null
        : [
            {
              type: 'message',
              role: 'assistant',
              content:
                mode === 'refused'
                  ? [{ type: 'refusal', refusal: 'provider private refusal' }]
                  : [{ type: 'output_text', text, annotations: [] }],
            },
          ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 130,
    },
  }
  const deltas =
    mode === 'refused'
      ? []
      : [...text].map((delta) => ({
          type: 'response.output_text.delta',
          delta,
          output_index: 0,
          content_index: 0,
          item_id: 'msg_1',
          sequence_number: 1,
        }))
  return (
    [
      ...deltas,
      ...(mode === 'missing_terminal'
        ? []
        : [
            {
              type: mode === 'truncated' ? 'response.incomplete' : 'response.completed',
              response: terminal,
            },
          ]),
    ]
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('') + (mode === 'trailing_invalid' ? 'data: {broken\n\n' : 'data: [DONE]\n\n')
  )
}

function harness(mode: Mode) {
  const request = replyV2Request()
  const preparer = createAiGatewayRoutePreparer({
    requestBindingKeys: REQUEST_KEYS,
    safetyIdentifierKey: Buffer.alloc(32, 8),
    provenanceKid: 'reply-v1',
    provenancePrivateKey: KEYS.privateKey,
    replyLanguageDetector: {
      detect: () => ({ language: 'en', probability: 0.99, reliable: true }),
    },
    now: () => NOW,
  })
  const prepared = preparer.prepare(request)
  const grant = signAiExecutionGrant(
    {
      version: 'ai-execution-grant-v1',
      subjectKind: 'property',
      grantKid: 'grant-v1',
      requestBindingKeyId: prepared.invocation.requestBindingKeyId,
      requestBindingHmac: prepared.invocation.requestBindingHmac,
      route: 'reply-suggestion',
      operationId: request.operationId,
      permitId: request.permitId,
      attemptNumber: 1,
      nonce: Buffer.alloc(32, 1).toString('base64url'),
      limits: prepared.invocation.descriptor.limits,
      callerDeadlineEpochMillis: NOW + 70_000,
      issuedAtEpochMillis: NOW,
      expiresAtEpochMillis: NOW + 70_000,
      replyTokenExpiresAtEpochMillis: NOW + 60_000,
      replyDraftExpiresAtEpochMillis: NOW + 60_000,
    },
    KEYS.privateKey,
  )
  const settle = vi.fn(async (settlement) => ({
    status: 'settled' as const,
    receipt: signAiSettlementReceipt(
      {
        version: 'ai-settlement-receipt-v1',
        receiptKid: 'grant-v1',
        grantKid: 'grant-v1',
        operationId: settlement.operationId,
        permitId: settlement.permitId,
        attemptNumber: 1,
        nonce: settlement.nonce,
        requestBindingHmac: prepared.invocation.requestBindingHmac,
        disposition: settlement.disposition,
        reportedDisposition: settlement.reportedDisposition,
        providerRetryable: false,
        usageKnown: settlement.usageKnown,
        inputTokens: settlement.inputTokens,
        cachedInputTokens: settlement.cachedInputTokens,
        outputTokens: settlement.outputTokens,
        reasoningTokens: settlement.reasoningTokens,
        costMicros: settlement.usageKnown
          ? Number(settledCostMicros(settlement))
          : grant.limits.costMicros,
        settledAtEpochMillis: NOW + 1000,
        settlementState: 'settled',
      },
      KEYS.privateKey,
    ),
  }))
  const outboundFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const wire = JSON.parse(Buffer.from(init!.body as Uint8Array).toString('utf8'))
    expect(wire).toMatchObject({ stream: true, background: false, store: false })
    return new Response(events(mode), {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
  })
  const service = createAiEgressGatewayService({
    now: () => NOW,
    preparer: { prepare: () => prepared },
    admissionPublicKeys: new Map([['grant-v1', KEYS.publicKey]]),
    admission: {
      readiness: async () => true,
      authorize: async () => ({ status: 'authorized', grant }),
      settle,
    },
    connector: createOpenAiConnector({
      apiKey: 'test-key',
      requestBindingKeys: REQUEST_KEYS,
      admissionPublicKeys: new Map([['grant-v1', KEYS.publicKey]]),
      outboundFetch,
      now: () => NOW,
    }),
  })
  const lease = createSensitiveSourceLease<typeof request>()
  lease.attachSource(structuredClone(request), (value) => value.source)
  return { service, lease, settle, outboundFetch, prepared, grant }
}

describe('reply v2 streamed provider call through settlement', () => {
  it.each([
    'success',
    'invalid',
    'truncated',
    'refused',
    'missing_terminal',
    'disconnect',
    'trailing_invalid',
    'malformed_terminal',
  ] as const)('settles %s exactly once, with no partial text delivered', async (mode) => {
    const h = harness(mode)
    const progress: ReplyDraftingProgress[] = []
    const result = await h.service.execute(
      h.lease,
      new AbortController().signal,
      (event) => {
        if (mode === 'disconnect') throw new Error('browser gone')
        progress.push(event)
      },
    )
    expect(h.outboundFetch).toHaveBeenCalledOnce()
    expect(h.settle).toHaveBeenCalledOnce()
    expect(h.settle.mock.calls[0]![0]).toMatchObject({
      usageKnown: mode !== 'missing_terminal',
      inputTokens: mode === 'missing_terminal' ? 0 : 100,
      outputTokens: mode === 'missing_terminal' ? 0 : 30,
    })
    if (mode === 'success' || mode === 'disconnect') {
      expect(result.status).toBe('success')
      const receipt = (await h.settle.mock.results[0]!.value).receipt
      expect(result).toEqual(
        h.prepared.acceptProviderResult(OUTPUT)!.buildResponse(receipt, h.grant),
      )
    } else {
      expect(result).toMatchObject({
        status: 'error',
        code:
          mode === 'truncated'
            ? 'output_truncated'
            : mode === 'refused'
              ? 'provider_refused'
              : 'output_invalid',
      })
      expect(JSON.stringify(result)).not.toContain(OUTPUT.replyText)
    }
    if (mode === 'success')
      expect(progress).toEqual([
        { step: 'thinking' },
        { step: 'answering', sentenceNumbers: [1] },
        { step: 'writing' },
        { step: 'checking' },
      ])
    expect(JSON.stringify(progress)).not.toMatch(
      /replyText|avoidTerms|Your time|provider private/,
    )
    expect(JSON.stringify(h.settle.mock.calls)).not.toMatch(
      /replyText|avoidTerms|Your time/,
    )
  })
  it('bounds the full stream and refuses compressed/non-SSE responses', async () => {
    const invalid = (reason: string) => new Error(reason)
    expect(() =>
      boundedProviderEventStream(
        new Response('', { headers: { 'content-type': 'application/json' } }),
        10,
        invalid,
      ),
    ).toThrow('content_type')
    expect(() =>
      boundedProviderEventStream(
        new Response('', {
          headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' },
        }),
        10,
        invalid,
      ),
    ).toThrow('content_encoding')
    await expect(
      boundedProviderEventStream(
        new Response('x'.repeat(11), {
          headers: { 'content-type': 'text/event-stream' },
        }),
        10,
        invalid,
      ).text(),
    ).rejects.toThrow('response_bytes')
  })
  it('pins the streaming-only attestation and deployment separately from the v1 contract', () => {
    expect(OPENAI_REPLY_STREAM_SHAPE_DIGEST).toBe(
      'f67f33645f1a50218dc369daa627337738b540db44840f9faf11bc403034f9f0',
    )
    expect(OPENAI_REPLY_STREAM_ATTESTATION.digest).toBe(
      '2865f0deb5cec73cf3e398a8539a2613c7afd22b99c470f943f1418ca4e4b54f',
    )
    expect(REPLY_STREAM_DEPLOYMENT.profileDigest).toBe(
      'b2928b02ca10e68aeebc5aa6a93065dc825adfd60aadcab3907ded116f558b89',
    )
    expect(OPENAI_REPLY_STREAM_ATTESTATION.transport.successMediaTypeProfile).toBe(
      'text-event-stream-utf8-bounded-v1',
    )
    expect(REPLY_STREAM_DEPLOYMENT.profileVersion).toBe('private-beta-global-v3')
  })
})

it('requires the terminal JSON text to match the bounded accumulated deltas', async () => {
  const h = harness('success')
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () =>
      new Response(events('success').replace('"delta":"W"', '"delta":"X"'), {
        headers: { 'content-type': 'text/event-stream' },
      }),
  })
  const response = await readOpenAiReplyStream(
    client,
    { sdkRequest: openAiRequestOf(h.prepared) },
    replyDraftingV2OutputSchema,
    new AbortController().signal,
  )
  expect(response.output_parsed).toBeNull()
  expect(response.usage?.input_tokens).toBe(100)
})

it('rejects malformed UTF-8 even when split across SSE chunks', async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xc3]))
        controller.enqueue(new Uint8Array([0x28]))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
  await expect(
    boundedProviderEventStream(response, 100, (reason) => new Error(reason)).text(),
  ).rejects.toThrow('response_utf8')
})
