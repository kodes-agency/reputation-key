// WP2.3 — the AI inference port, calling the egress gateway in this process.
//
// This replaces `ai-gateway.adapter.ts`, which spoke to a sidecar over mTLS.
// What that adapter did in 275 lines, more than half of it was re-establishing
// trust in a reply that had crossed a wire: status and media-type checks, a
// content-encoding refusal, a bounded-JSON parse and an Ed25519 settlement
// receipt verification binding the reply to the request. None of that has a
// subject when the callee is a function in this process, so it is gone.
//
// WHAT DELIBERATELY SURVIVES, because it is product rule rather than transport:
//   - the caller/route authorization. `AI_RUNTIME_CAPABILITIES_V1` declares
//     which process may invoke which route (reply drafting is web-callable,
//     trend analysis is worker-only). That is a real constraint on what a
//     process may spend money on, and it outlives the wire.
//   - the per-route deadline ceiling, so a caller cannot ask for an unbounded
//     provider call.
//   - the per-route source byte bound. Review text originates from Google, not
//     from us, so it is untrusted input regardless of how it reaches the
//     gateway; the bound stays and is still measured before the source is used.
//   - the sensitive-source lease. Merchant content is zeroed after the gateway
//     reads it, exactly as it was when the bytes came off a socket.

import {
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
} from '#/shared/ai-internal-transport-contract'
import { AI_RUNTIME_CAPABILITIES_V1 } from '#/shared/ai-runtime-capability-contract'
import { createSensitiveSourceLease } from '#/shared/ai-provider-control/source-lease'
import type { AiEgressGatewayService } from '#/shared/ai-provider-control/service'
import type { AiInferencePort } from '../../application/ports/ai-inference.port'

const OUTER_DEADLINE_MILLIS = Object.freeze({
  'review-analysis': 100_000,
  'reply-suggestion': 100_000,
  'property-trend': 100_000,
} satisfies Readonly<Record<AiGatewayRouteRequestV1['route'], number>>)

const REQUEST_MAX_BYTES = Object.freeze({
  'review-analysis': AI_REVIEW_ROUTE_MAX_BYTES,
  'reply-suggestion': AI_REVIEW_ROUTE_MAX_BYTES,
  'property-trend': AI_TREND_ROUTE_MAX_BYTES,
} satisfies Readonly<Record<AiGatewayRouteRequestV1['route'], number>>)

export type CreateAiInProcessInferenceInput = Readonly<{
  /** Resolved lazily: the gateway loads a language model on first construction. */
  gateway: () => Promise<AiEgressGatewayService>
  caller: AiGatewayCaller
  nowEpochMillis?: () => number
}>

function verifyDeadline(
  route: AiGatewayRouteRequestV1['route'],
  deadlineEpochMillis: number,
  nowEpochMillis: number,
): void {
  const remaining = deadlineEpochMillis - nowEpochMillis
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new TypeError('AI gateway request deadline has passed')
  }
  if (remaining > OUTER_DEADLINE_MILLIS[route]) {
    throw new TypeError('AI gateway request deadline exceeds its route ceiling')
  }
}

/**
 * The lease zeroes the mutable fields of the root it is given once the gateway
 * has read it. Over the wire that root was freshly parsed from bytes the sidecar
 * owned, so scrubbing it could not surprise anyone. In this process the request
 * belongs to the caller, so the lease is handed a copy: the caller keeps its
 * object intact and the copy the gateway reads is destroyed. Skipping the copy
 * would silently null out fields on a request the caller may still be holding —
 * for a retry, a log line or an assertion.
 */
function leaseFor(request: AiGatewayRouteRequestV1) {
  const lease = createSensitiveSourceLease<AiGatewayRouteRequestV1>()
  const copy = structuredClone(request) as AiGatewayRouteRequestV1
  lease.attachSource(copy, (value) => value.source)
  return lease
}

export const createAiInProcessInference = (
  input: CreateAiInProcessInferenceInput,
): AiInferencePort => {
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
    verifyDeadline(request.route, request.deadlineEpochMillis, nowEpochMillis())

    // Measured, then discarded. The encoding exists only to size the source
    // against its route bound; the gateway reads the object, not these bytes.
    const encoded = new TextEncoder().encode(JSON.stringify(request))
    try {
      if (encoded.byteLength > REQUEST_MAX_BYTES[request.route]) {
        throw new TypeError('AI gateway request exceeded its route bound')
      }
    } finally {
      encoded.fill(0)
    }

    const gateway = await input.gateway()
    const lease = leaseFor(request)
    try {
      return await gateway.execute(lease, signal)
    } finally {
      // `execute` disposes the lease on every path it owns; this covers the
      // paths it does not reach, and disposal is idempotent.
      lease.dispose()
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
