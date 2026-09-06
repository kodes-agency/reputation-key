// The caller/route authorization survived WP2.3; the mechanism carrying it did not.
//
// Before the collapse this rule was enforced from an mTLS client certificate:
// `assertAiGatewayPeerRoute` mapped a SPIFFE identity to a caller and refused
// route/caller pairs the runtime catalogue did not declare, and
// `ai-gateway-transport-contract.test.ts` asserted it over peer identities.
// There is no peer and no certificate now, so that test lost its subject and was
// deleted rather than re-pinned to a shape that no longer exists.
//
// The RULE is not transport trivia and did not go with it: `reply-suggestion` is
// web-callable and `property-trend` is worker-only, and getting that wrong means
// a process spending provider money on a route it was never authorized for. So
// the coverage moved here, to the module that now enforces it.

import { describe, expect, it } from 'vitest'
import { AI_RUNTIME_CAPABILITIES_V1 } from '#/shared/ai-runtime-capability-contract'
import type { AiEgressGatewayService } from '#/shared/ai-provider-control/service'
import type { AiGatewayRouteRequestV1 } from '#/shared/ai-gateway-transport-contract'
import {
  analysisRequest,
  replyRequest,
  trendRequest,
} from '#/shared/ai-gateway-transport-contract.test-fixtures'
import { createAiInProcessInference } from './ai-inprocess.adapter'

const NOW = 1_700_000_000_000

/**
 * A gateway that records what reached it and answers on the requested route.
 * The adapter's contract is what it lets through, so the double only has to be
 * faithful about the route discriminant.
 */
function recordingGateway() {
  const seen: AiGatewayRouteRequestV1['route'][] = []
  const service: AiEgressGatewayService = {
    execute: async (lease) => {
      const route = lease.read((request) => request.route)
      seen.push(route)
      return Object.freeze({
        route,
        status: 'error',
        code: 'operation_ambiguous',
        retryAfterEpochMillis: null,
      }) as never
    },
    readiness: async () => true,
  }
  return { seen, service }
}

/**
 * A schema-VALID request per route. The adapter parses with the same strict
 * schema the wire used before it authorizes anything, so a partial object never
 * reaches the authorization branch under test — it fails parsing first.
 */
function requestFor(route: AiGatewayRouteRequestV1['route']): AiGatewayRouteRequestV1 {
  const base =
    route === 'reply-suggestion'
      ? replyRequest()
      : route === 'property-trend'
        ? trendRequest()
        : analysisRequest()
  return { ...base, deadlineEpochMillis: NOW + 30_000 }
}

describe('in-process AI inference caller authorization', () => {
  it('declares exactly one caller per route, so the table below is exhaustive', () => {
    // Positive control: if the catalogue grew a route, the pairs asserted here
    // would silently stop covering it.
    expect(
      AI_RUNTIME_CAPABILITIES_V1.map((entry) => [entry.sourceRoute, entry.caller]).sort(),
    ).toEqual(
      [
        ['review-analysis', 'worker'],
        ['reply-suggestion', 'web'],
        ['property-trend', 'worker'],
      ].sort(),
    )
  })

  it.each([
    ['reply-suggestion', 'web'],
    ['review-analysis', 'worker'],
    ['property-trend', 'worker'],
  ] as const)('lets %s through from its declared caller (%s)', async (route, caller) => {
    const { seen, service } = recordingGateway()
    const port = createAiInProcessInference({
      gateway: async () => service,
      caller,
      nowEpochMillis: () => NOW,
    })
    const call =
      route === 'reply-suggestion'
        ? port.generateReply
        : route === 'property-trend'
          ? port.generateTrend
          : port.analyzeReview
    await call(requestFor(route) as never, new AbortController().signal)
    expect(seen).toEqual([route])
  })

  it.each([
    ['review-analysis', 'web'],
    ['property-trend', 'web'],
    ['reply-suggestion', 'worker'],
  ] as const)(
    'refuses %s from %s and never reaches the gateway',
    async (route, caller) => {
      const { seen, service } = recordingGateway()
      const port = createAiInProcessInference({
        gateway: async () => service,
        caller,
        nowEpochMillis: () => NOW,
      })
      const call =
        route === 'reply-suggestion'
          ? port.generateReply
          : route === 'property-trend'
            ? port.generateTrend
            : port.analyzeReview
      await expect(
        call(requestFor(route) as never, new AbortController().signal),
      ).rejects.toThrow(/caller is not authorized for route/)
      // The refusal must precede the provider call, not follow it — an authorized
      // spend is exactly what this boundary exists to prevent.
      expect(seen).toEqual([])
    },
  )
})

describe('in-process AI inference deadlines and construction', () => {
  it('refuses a deadline that has already passed', async () => {
    const { service } = recordingGateway()
    const port = createAiInProcessInference({
      gateway: async () => service,
      caller: 'web',
      nowEpochMillis: () => NOW,
    })
    const request = { ...requestFor('reply-suggestion'), deadlineEpochMillis: NOW - 1 }
    await expect(
      port.generateReply(request as never, new AbortController().signal),
    ).rejects.toThrow(/deadline has passed/)
  })

  it('refuses a deadline beyond the route ceiling', async () => {
    const { service } = recordingGateway()
    const port = createAiInProcessInference({
      gateway: async () => service,
      caller: 'web',
      nowEpochMillis: () => NOW,
    })
    const request = {
      ...requestFor('reply-suggestion'),
      deadlineEpochMillis: NOW + 10_000_000,
    }
    await expect(
      port.generateReply(request as never, new AbortController().signal),
    ).rejects.toThrow(/exceeds its route ceiling/)
  })

  it('leaves the caller its request intact after the gateway scrubs its copy', async () => {
    // The lease nulls the mutable fields of what it is handed. Over the wire that
    // was a freshly parsed object the sidecar owned; in-process the request
    // belongs to the caller, so the adapter must hand over a copy.
    const { service } = recordingGateway()
    const port = createAiInProcessInference({
      gateway: async () => service,
      caller: 'web',
      nowEpochMillis: () => NOW,
    })
    const request = requestFor('reply-suggestion')
    // Hold the fixture's own source object, so the assertion reads the real
    // nested value the lease would have nulled had the adapter handed it over
    // directly instead of cloning.
    const { source } = request
    const before = JSON.stringify(source)
    await port.generateReply(request as never, new AbortController().signal)
    expect(JSON.stringify(source)).toBe(before)
  })
})
