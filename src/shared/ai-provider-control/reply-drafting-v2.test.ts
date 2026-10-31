import * as leakage from '#/shared/ai-reply-output-leakage'
import { createAiEgressGatewayService } from './service'
import { createSensitiveSourceLease } from './source-lease'
import { signAiSettlementReceipt } from '#/shared/ai-internal-transport-contract'
import { settledCostMicros } from '#/shared/ai-openai-provider-profile'
import type { AiAdmissionClient } from './contracts'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { createAiGatewayRoutePreparer } from './route-preparer'
import { replyV2Request } from './reply-drafting-v2.test-fixtures'
import { openAiRequestOf } from './review-evidence.test-fixtures'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { signAiExecutionGrant } from '#/shared/ai-internal-transport-contract'
import {
  verifyAiReplyProvenance,
  digestRenderedReply,
} from '#/shared/ai-reply-provenance'
import { maximumCostMicros } from '#/shared/ai-openai-provider-profile'
import { REPLY_DRAFTING_V2_OPERATION_PROFILE } from '#/shared/reply-drafting-v2-profile'
import { REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES } from '#/shared/reply-drafting-v2-request'
import { aiGatewayRequestMaxBytes } from '#/contexts/ai/infrastructure/adapters/ai-inprocess.adapter'

const KEYS = generateKeyPairSync('ed25519')
const NOW = 1_780_000_000_000
const BODY =
  'We are sorry the wait took so long. Your time should have been treated with more care.'
const OUTPUT = {
  languageCode: 'en-Latn',
  case: 'complaint',
  mainPoint: [1],
  avoidTerms: [],
  replyText: BODY,
}
function preparer(
  language = 'en',
  onOutputRefused?: Parameters<typeof createAiGatewayRoutePreparer>[0]['onOutputRefused'],
) {
  return createAiGatewayRoutePreparer({
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'07'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 8),
    onOutputRefused,
    provenanceKid: 'reply-v1',
    provenancePrivateKey: KEYS.privateKey,
    replyLanguageDetector: {
      detect: () => ({ language, probability: 0.99, reliable: true }),
    },
    now: () => NOW,
  })
}

describe('reply v2 provider preparation and acceptance', () => {
  it.each([
    ['shape', { ...OUTPUT, avoidTerms: ['x'] }],
    ['language', { ...OUTPUT, languageCode: 'bg-Cyrl' }],
    [
      'invitation',
      { ...OUTPUT, replyText: 'We are sorry. Call us about the wait, please.' },
    ],
  ])('attributes %s using controlled codes only', (reason, output) => {
    const refused = vi.fn()
    const prepared = preparer('en', refused).prepare(replyV2Request())
    expect(prepared.acceptProviderResult(output)).toBeNull()
    expect(refused).toHaveBeenCalledWith({ route: 'reply-suggestion', reason })
    expect(JSON.stringify(refused.mock.calls)).not.toContain(output.replyText)
  })

  it('attributes unavailable scanners without a rewrite', () => {
    const scanner = vi
      .spyOn(leakage, 'scanAiReplyOutput')
      .mockReturnValue('scanner_unavailable')
    const refused = vi.fn()
    try {
      const prepared = preparer('en', refused).prepare(replyV2Request())
      expect(prepared.acceptProviderResult(OUTPUT)).toBeNull()
      expect(refused).toHaveBeenCalledWith({
        route: 'reply-suggestion',
        reason: 'scanner_unavailable',
      })
      expect(prepared.repairIssues?.()).toEqual([])
    } finally {
      scanner.mockRestore()
    }
  })

  it('attributes final frame limits and language failures', () => {
    const refused = vi.fn()
    const limits = replyV2Request()
    limits.replyV2Frame!.candidates[0]!.suffix = 'x'.repeat(4096)
    expect(
      preparer('en', refused).prepare(limits).acceptProviderResult(OUTPUT),
    ).toBeNull()
    expect(refused).toHaveBeenLastCalledWith({
      route: 'reply-suggestion',
      reason: 'reply_limits',
    })
    const language = replyV2Request()
    language.replyV2Frame!.candidates[0]!.suffix =
      'Това е дълъг текст на друг език. '.repeat(5)
    expect(
      preparer('en', refused).prepare(language).acceptProviderResult(OUTPUT),
    ).toBeNull()
    expect(refused).toHaveBeenLastCalledWith({
      route: 'reply-suggestion',
      reason: 'language_verification',
    })
  })

  it('passes the served gateway after switch-on', () =>
    expect(
      parseAiGatewayRouteRequest(replyV2Request()).binding.operationProfileVersion,
    ).toBe('reply-suggestion-v2'))
  it('uses numbered redaction, fixed knobs, synthetic examples and the v2 prompt identity', () => {
    const request = replyV2Request(
      'We waited a long time.\nContact person@example.test for more information.',
    )
    const prepared = preparer().prepare(request)
    const wire = openAiRequestOf(prepared)
    const payload = JSON.parse(wire.input[1].content)
    expect(payload.sentences).toHaveLength(2)
    expect(payload.sentences.map((s: { n: number }) => s.n)).toEqual([1, 2])
    expect(JSON.stringify(payload)).not.toContain('person@example.test')
    expect(Object.keys(payload).sort()).toEqual(
      [
        'apologyStart',
        'languageCode',
        'length',
        'opening',
        'rating',
        'replyProfileVersion',
        'sentences',
        'tone',
      ].sort(),
    )
    expect(wire.prompt_cache_key).toContain('reply-suggestion-prompt-v2')
    expect(wire).toMatchObject({
      reasoning: { effort: 'medium' },
      max_output_tokens: 2048,
    })
    expect(wire.input[0].content).toContain('Examples of the style')
    expect(JSON.stringify(payload)).not.toMatch(/Jane|Manager|Owner|private@example/)
    expect(aiGatewayRequestMaxBytes(request)).toBe(131_072)
    const expected = maximumCostMicros(
      {
        ...REPLY_DRAFTING_V2_OPERATION_PROFILE,
        staticTokenBearingBytes:
          REPLY_DRAFTING_V2_OPERATION_PROFILE.staticTokenBearingBytes +
          REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES,
      },
      prepared.invocation.descriptor.providerPayloadByteCount,
    )
    expect(prepared.invocation.descriptor.limits.costMicros).toBe(expected)
  })
  it('refuses invalid numbering, changed voice identity and arbitrary apology text', () => {
    const numbering = replyV2Request()
    numbering.source.sentences = [
      { number: 2, text: numbering.source.sentences![0]!.text },
    ]
    expect(() => preparer().prepare(numbering)).toThrow('invalid_request')
    const voice = replyV2Request()
    voice.replyV2Frame!.voiceDigest = 'c'.repeat(64)
    expect(() => preparer().prepare(voice)).toThrow('policy_unavailable')
    const arbitrary = replyV2Request()
    arbitrary.binding.replyDraftingV2!.options.apologyStart = 'client words'
    expect(() => preparer().prepare(arbitrary)).toThrow('Invalid drafting options')
  })
  it('carries only controlled codes after a hard failure and never feeds rejected wording to a rewrite', () => {
    const rejected = 'We are sorry. Call us about the cockroaches, please.'
    const prepared = preparer().prepare(replyV2Request())
    expect(
      prepared.acceptProviderResult({
        ...OUTPUT,
        avoidTerms: ['cockroaches'],
        replyText: rejected,
      }),
    ).toBeNull()
    expect(prepared.repairIssues?.()).toEqual(
      expect.arrayContaining(['invitation', 'damaging_words', 'avoidance']),
    )
    const child = replyV2Request()
    Object.assign(child.binding.replyDraftingV2!, {
      parentOperationId: child.operationId,
      rewriteOrdinal: 1,
      rewriteIssues: prepared.repairIssues!(),
    })
    const message = openAiRequestOf(preparer().prepare(child)).input[0].content
    expect(message).not.toContain(rejected)
    expect(message).not.toContain('cockroaches, please')
    expect(message).toContain('A previous draft for this review broke these rules:')
  })
  it('signs the exact accepted framed text and authenticates Spanish choices without avoidance metadata', () => {
    const request = replyV2Request(
      'Esperamos mucho tiempo. La habitación era tranquila.',
      'es-Latn',
    )
    const prepared = preparer('es').prepare(request)
    const accepted = prepared.acceptProviderResult({
      ...OUTPUT,
      languageCode: 'es-Latn',
      replyText: 'Sentimos que la espera fuera tan larga. Su tiempo merece más atención.',
    })!
    expect(accepted).not.toBeNull()
    const grant = signAiExecutionGrant(
      {
        version: 'ai-execution-grant-v1',
        subjectKind: 'property',
        grantKid: 'grant-v1',
        requestBindingKeyId: 'request-v1',
        requestBindingHmac: 'A'.repeat(43),
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
    const response = accepted.buildResponse({} as never, grant)
    expect(response.status).toBe('success')
    if (response.status !== 'success' || response.route !== 'reply-suggestion')
      throw new Error('Expected reply')
    const token = verifyAiReplyProvenance(
      response.result.provenanceToken,
      new Map([['reply-v1', KEYS.publicKey]]),
    )
    expect(token).toMatchObject({
      version: 'ai-reply-provenance-v4',
      templateGroup: 'es-Latn',
      renderedSuggestionDigest: digestRenderedReply(response.result.replyText),
      voiceChoices: { closing: -1 },
    })
    expect(response.result).not.toHaveProperty('avoidTerms')
    expect(JSON.stringify(token)).not.toContain('avoidTerms')
  })
  it('binds every option and voice identity in the descriptor HMAC', () => {
    const original = preparer().prepare(replyV2Request())
    const changed = replyV2Request()
    changed.binding.replyDraftingV2!.options.maxWords = 18
    changed.binding.replyDraftingV2!.options.length = 'short'
    const next = preparer().prepare(changed)
    expect(next.invocation.requestBindingHmac).not.toBe(
      original.invocation.requestBindingHmac,
    )
    expect(
      createHash('sha256').update(next.invocation.canonicalProviderBytes).digest('hex'),
    ).not.toBe(
      createHash('sha256')
        .update(original.invocation.canonicalProviderBytes)
        .digest('hex'),
    )
  })
  it('settles a rejected answer once before returning only fixed rewrite codes', async () => {
    const request = replyV2Request()
    const prepared = preparer().prepare(request)
    const rejected = 'We are sorry. Call us about the cockroaches, please.'
    const charge = vi.fn<AiAdmissionClient['settle']>(async (settlement) => ({
      status: 'settled',
      receipt: signAiSettlementReceipt(
        {
          version: 'ai-settlement-receipt-v1',
          receiptKid: 'grant-v1',
          grantKid: 'grant-v1',
          operationId: settlement.operationId,
          permitId: settlement.permitId,
          attemptNumber: settlement.attemptNumber,
          nonce: settlement.nonce,
          requestBindingHmac: prepared.invocation.requestBindingHmac,
          disposition: settlement.disposition,
          reportedDisposition: settlement.reportedDisposition,
          providerRetryable: settlement.providerRetryable,
          usageKnown: settlement.usageKnown,
          inputTokens: settlement.inputTokens,
          cachedInputTokens: settlement.cachedInputTokens,
          outputTokens: settlement.outputTokens,
          reasoningTokens: settlement.reasoningTokens,
          costMicros: Number(settledCostMicros(settlement)),
          settledAtEpochMillis: NOW + 1_000,
          settlementState: 'settled',
        },
        KEYS.privateKey,
      ),
    }))
    const service = createAiEgressGatewayService({
      now: () => NOW,
      preparer: { prepare: () => prepared },
      admissionPublicKeys: new Map([['grant-v1', KEYS.publicKey]]),
      admission: {
        readiness: async () => true,
        settle: charge,
        authorize: async () => ({
          status: 'authorized',
          grant: signAiExecutionGrant(
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
          ),
        }),
      },
      connector: {
        invoke: async () => ({
          disposition: 'success',
          reportedDisposition: 'success',
          result: { ...OUTPUT, avoidTerms: ['cockroaches'], replyText: rejected },
          usageKnown: true,
          providerRetryable: false,
          usage: {
            inputTokens: 100,
            cachedTokens: 0,
            outputTokens: 20,
            reasoningTokens: 0,
            totalTokens: 120,
          },
          retryAfterSeconds: null,
          outboundFetchUsed: true,
        }),
      },
    })
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(structuredClone(request), (value) => value.source)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const result = await service.execute(lease, new AbortController().signal)
      expect(result).toMatchObject({
        status: 'error',
        code: 'output_invalid',
        rewriteIssues: expect.arrayContaining(['invitation', 'avoidance']),
      })
      expect(charge).toHaveBeenCalledTimes(1)
      expect(charge.mock.calls[0]![0]).toMatchObject({
        disposition: 'output_invalid',
        usageKnown: true,
        inputTokens: 100,
        outputTokens: 20,
      })
      expect(JSON.stringify(result)).not.toContain(rejected)
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('cockroaches')
      expect(JSON.stringify(charge.mock.calls)).not.toContain('avoidTerms')
    } finally {
      stderr.mockRestore()
    }
  })
})
