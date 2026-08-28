import type { KeyObject } from 'node:crypto'
import {
  AI_GATEWAY_PATHS_V1,
  aiGatewayRouteResponseSchema,
  assertAiGatewayPeerRoute,
  parseAiGatewayRouteRequest,
  type AiGatewayCaller,
  type AiGatewayRouteRequestV1,
  type AiGatewayRouteResponseV1,
  type AnalysisResult,
  type ReplySuggestionResult,
  type TrendResult,
} from '#/shared/ai-gateway-transport-contract'
import {
  AI_REVIEW_ROUTE_MAX_BYTES,
  AI_TREND_ROUTE_MAX_BYTES,
  AI_INTERNAL_RESPONSE_MAX_BYTES,
  parseAiInternalJsonBytes,
  verifyAiSettlementReceipt,
} from '#/shared/ai-internal-transport-contract'
import { AI_RUNTIME_CAPABILITIES_V1 } from '#/shared/ai-runtime-capability-contract'
import type { AiInferencePort } from '../../application/ports/ai-inference.port'

const OUTER_DEADLINE_MILLIS = Object.freeze({
  'review-analysis': 70_000,
  'reply-suggestion': 70_000,
  'property-trend': 100_000,
} satisfies Readonly<Record<AiGatewayRouteRequestV1['route'], number>>)
const REQUEST_MAX_BYTES = Object.freeze({
  'review-analysis': AI_REVIEW_ROUTE_MAX_BYTES,
  'reply-suggestion': AI_REVIEW_ROUTE_MAX_BYTES,
  'property-trend': AI_TREND_ROUTE_MAX_BYTES,
} satisfies Readonly<Record<AiGatewayRouteRequestV1['route'], number>>)

export type AiGatewayByteTransport = Readonly<{
  postBytesRaw(
    path: string,
    body: Uint8Array,
    options: Readonly<{ signal?: AbortSignal; deadlineEpochMillis?: number }>,
  ): Promise<Readonly<{ status: number; headers: Headers; body: Uint8Array }>>
}>

export type CreateAiGatewayAdapterInput = Readonly<{
  transport: AiGatewayByteTransport
  caller: AiGatewayCaller
  admissionSettlementPublicKeys: ReadonlyMap<string, KeyObject>
  nowEpochMillis?: () => number
}>

function isApplicationJsonUtf8(value: string | null): boolean {
  if (value === null) return false
  const separator = value.indexOf(';')
  if (separator === -1) return value.toLowerCase() === 'application/json'
  if (value.slice(0, separator).toLowerCase() !== 'application/json') return false

  const parameter = value.slice(separator + 1).toLowerCase()
  let index = 0
  const skipWhitespace = (): void => {
    while (parameter[index] === ' ' || parameter[index] === '\t') index += 1
  }
  skipWhitespace()
  if (!parameter.startsWith('charset', index)) return false
  index += 'charset'.length
  skipWhitespace()
  if (parameter[index] !== '=') return false
  index += 1
  skipWhitespace()
  return parameter.slice(index) === 'utf-8'
}

function verifyDeadline(
  route: AiGatewayRouteRequestV1['route'],
  deadlineEpochMillis: number,
  nowEpochMillis: number,
): void {
  if (
    !Number.isSafeInteger(nowEpochMillis) ||
    !Number.isSafeInteger(deadlineEpochMillis) ||
    deadlineEpochMillis <= nowEpochMillis ||
    deadlineEpochMillis - nowEpochMillis > OUTER_DEADLINE_MILLIS[route]
  ) {
    throw new TypeError('AI gateway caller deadline is invalid')
  }
}

function verifyResponseBinding(
  request: AiGatewayRouteRequestV1,
  response: AiGatewayRouteResponseV1,
  admissionSettlementPublicKeys: ReadonlyMap<string, KeyObject>,
): void {
  if (response.route !== request.route) {
    throw new TypeError('AI gateway response is invalid')
  }
  if (response.status === 'success') {
    const receipt = response.settlementReceipt
    if (
      receipt.operationId !== request.operationId ||
      receipt.permitId !== request.permitId ||
      receipt.attemptNumber !== request.attemptNumber ||
      receipt.disposition !== 'success' ||
      receipt.settlementState !== 'settled' ||
      !admissionSettlementPublicKeys.has(receipt.grantKid) ||
      !verifyAiSettlementReceipt(receipt, admissionSettlementPublicKeys)
    ) {
      throw new TypeError('AI gateway response is invalid')
    }
  }
  if (response.status !== 'success') return
  if (request.route === 'reply-suggestion' && response.route === 'reply-suggestion') {
    const language = request.binding.concreteReplyLanguage
    const fence = request.binding.capabilityFence
    if (
      language === null ||
      fence.capability !== 'reply_drafting' ||
      response.result.profileVersion !== request.replyProfileVersion ||
      response.result.concreteLanguageTag !== language.tag ||
      response.result.templateGroup !== language.templateGroup ||
      response.result.baseReplyStateRevision !== fence.baseReplyStateRevision
    ) {
      throw new TypeError('AI gateway response is invalid')
    }
  }
  if (request.route === 'property-trend' && response.route === 'property-trend') {
    const candidates = new Set<string>(request.source.candidates.map(({ id }) => id))
    if (response.result.selectedSignalIds.some((id) => !candidates.has(id))) {
      throw new TypeError('AI gateway response is invalid')
    }
  }
}

export const createAiGatewayAdapter = (
  input: CreateAiGatewayAdapterInput,
): AiInferencePort => {
  if (
    input.admissionSettlementPublicKeys.size === 0 ||
    [...input.admissionSettlementPublicKeys.values()].some((key) => key.type !== 'public')
  ) {
    throw new TypeError('AI admission settlement public keys are unavailable')
  }
  const nowEpochMillis = input.nowEpochMillis ?? Date.now

  const invoke = async (
    rawRequest: AiGatewayRouteRequestV1,
    signal: AbortSignal,
  ): Promise<AiGatewayRouteResponseV1> => {
    if (signal.aborted) throw new Error('AI gateway request was aborted')
    const request = parseAiGatewayRouteRequest(rawRequest)
    const runtimeEntry = AI_RUNTIME_CAPABILITIES_V1.find(
      (entry) => entry.sourceRoute === request.route,
    )
    if (runtimeEntry === undefined || runtimeEntry.caller !== input.caller) {
      throw new TypeError('AI gateway caller is not authorized for route')
    }
    assertAiGatewayPeerRoute(
      request.route,
      input.caller === 'web'
        ? 'spiffe://repkey.internal/repkey-web'
        : 'spiffe://repkey.internal/repkey-worker',
    )
    verifyDeadline(request.route, request.deadlineEpochMillis, nowEpochMillis())

    const encoded = new TextEncoder().encode(JSON.stringify(request))
    try {
      if (encoded.byteLength > REQUEST_MAX_BYTES[request.route]) {
        throw new TypeError('AI gateway request exceeded its route bound')
      }
      let rawResponse: Readonly<{ status: number; headers: Headers; body: Uint8Array }>
      try {
        rawResponse = await input.transport.postBytesRaw(
          AI_GATEWAY_PATHS_V1[request.route],
          encoded,
          { signal, deadlineEpochMillis: request.deadlineEpochMillis },
        )
      } catch (error) {
        // The transport leg, distinct from response validation below. This is
        // where a settled provider call still fails the client: the gateway
        // answers the provider, settles the permit, and the reply to this
        // process dies on the socket, the deadline or the mTLS session. Naming
        // the stage separately is the whole point — folding it into the same
        // four words as a schema rejection is what made this undiagnosable.
        // Content-free: a stage, an error class and a message, never bytes.
        process.stderr.write(
          `${JSON.stringify({
            event: 'ai_gateway_transport_failed',
            route: request.route,
            requestBytes: encoded.byteLength,
            deadlineEpochMillis: request.deadlineEpochMillis,
            aborted: signal?.aborted ?? null,
            reason: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message.slice(0, 160) : '',
            cause:
              error instanceof Error && error.cause instanceof Error
                ? `${error.cause.name}: ${error.cause.message.slice(0, 120)}`
                : null,
          })}\n`,
        )
        return Object.freeze({
          route: request.route,
          status: 'error',
          code: 'operation_ambiguous',
          retryAfterEpochMillis: null,
        }) as AiGatewayRouteResponseV1
      }
      try {
        if (rawResponse.status !== 200) {
          throw new TypeError(`AI gateway response status ${rawResponse.status}`)
        }
        if (rawResponse.headers.has('content-encoding')) {
          throw new TypeError('AI gateway response is encoded')
        }
        if (!isApplicationJsonUtf8(rawResponse.headers.get('content-type'))) {
          throw new TypeError('AI gateway response media type is invalid')
        }
        const response = parseAiInternalJsonBytes(
          rawResponse.body,
          AI_INTERNAL_RESPONSE_MAX_BYTES,
          aiGatewayRouteResponseSchema,
        )
        verifyResponseBinding(request, response, input.admissionSettlementPublicKeys)
        return response
      } catch (error) {
        // One bare catch used to fold five independent causes — non-200, an
        // encoded body, a wrong media type, a schema rejection and a failed
        // response-binding check — into the same four words on screen. The
        // reason is content-free: a stage name and an error class, never a body,
        // a token or provider bytes.
        process.stderr.write(
          `${JSON.stringify({
            event: 'ai_gateway_response_rejected',
            route: request.route,
            status: rawResponse.status,
            contentType: rawResponse.headers.get('content-type') ?? null,
            bodyBytes: rawResponse.body.byteLength,
            reason: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message.slice(0, 160) : '',
          })}\n`,
        )
        return Object.freeze({
          route: request.route,
          status: 'error',
          code: 'operation_ambiguous',
          retryAfterEpochMillis: null,
        }) as AiGatewayRouteResponseV1
      } finally {
        rawResponse.body.fill(0)
      }
    } finally {
      encoded.fill(0)
    }
  }

  return Object.freeze({
    analyzeReview: async (request, signal): Promise<AnalysisResult> => {
      const result = await invoke(request, signal)
      if (result.route !== 'review-analysis') {
        throw new TypeError('AI gateway response is invalid')
      }
      return result
    },
    generateReply: async (request, signal): Promise<ReplySuggestionResult> => {
      const result = await invoke(request, signal)
      if (result.route !== 'reply-suggestion') {
        throw new TypeError('AI gateway response is invalid')
      }
      return result
    },
    generateTrend: async (request, signal): Promise<TrendResult> => {
      const result = await invoke(request, signal)
      if (result.route !== 'property-trend') {
        throw new TypeError('AI gateway response is invalid')
      }
      return result
    },
  })
}
