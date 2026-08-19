import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_GATEWAY_KEY_INVENTORY_V1,
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1,
  OPENAI_PRICE_CATALOGUE_V1,
  OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
  OPENAI_PROVIDER_PRIMARY_SOURCES_V1,
  OPENAI_REQUEST_SHAPE_V1,
  OPENAI_REQUEST_SHAPE_V1_DIGEST,
  AI_SERVICE_DRAIN_SECONDS_V1,
  AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
} from './ai-openai-provider-profile'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
describe('OpenAI private-beta provider profile', () => {
  it('pins the exact SDK, snapshot request shape, transport, evidence, and price facts', () => {
    expect(OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1).toEqual({
      sdkVersion: '7.4.0',
      dispatcherVersion: 'undici@8.10.0',
      runtime: {
        nodeImage:
          'node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46',
        nodeVersion: '22.23.2',
        icuVersion: '78.2',
        unicodeVersion: '17.0',
      },
      endpoint: 'https://api.openai.com/v1/responses',
      promptCacheRetention: 'in_memory',
      promptCacheMode: 'automatic_prefix_16_shards',
      promptCacheOptions: 'absent',
      promptCacheBreakpoint: 'absent',
      truncation: 'disabled',
      tools: 'empty_array',
      metadata: 'absent',
      conversation: 'absent',
      previousResponseId: 'absent',
      stream: false,
      background: false,
      providerFallback: 'none',
      providerIdempotencyMode: 'none',
      sdkMaxRetries: 0,
      maxHttpRequestsPerPermit: 1,
      possibleDispatchBoundary: 'outbound_fetch_invocation',
      redirectMode: 'manual_no_follow',
      successStatus: 200,
      successMediaTypeProfile: 'application-json-utf8-v1',
      clientRequestIdProfile: 'openai-client-request-id-v1',
      retryAfterProfile: 'delta-seconds-1-to-300-v1',
      statusDispositionProfile: 'openai-status-disposition-v1',
      retryableCompleteStatuses: [429, 500, 502, 503, 504],
      serviceDrainSeconds: AI_SERVICE_DRAIN_SECONDS_V1,
      handlerDrainTimeoutMillis: AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
      gatewayRequestTimeoutMillis: 115_000,
      requestShapeDigest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
      evidence: {
        retrievalDate: '2026-08-15',
        primarySources: OPENAI_PROVIDER_PRIMARY_SOURCES_V1,
        normalizedClaimsDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      pricing: OPENAI_PRICE_CATALOGUE_V1,
      keyInventory: AI_GATEWAY_KEY_INVENTORY_V1,
    })
    expect(OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1).toMatchObject({
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      reasoningEffort: 'route-profile-effort',
      providerIdempotencyMode: 'none',
      abuseMonitoringRetention: 'generally-up-to-30-days-with-legal-safety-exceptions',
    })
    expect(OPENAI_REQUEST_SHAPE_V1).toMatchObject({
      model: 'gpt-5.4-mini-2026-03-17',
      reasoning: { effort: 'route-profile-effort' },
      serviceTier: 'default',
      promptCacheRetention: 'in_memory',
      store: false,
      tools: [],
      truncation: 'disabled',
      stream: false,
      background: false,
    })
  })

  it('changes the canonical digest for any request-shape mutation', () => {
    const mutation = { ...OPENAI_REQUEST_SHAPE_V1, store: true }
    const mutationDigest = createHash('sha256')
      .update('repkey-openai-request-shape-v1\0', 'utf8')
      .update(canonicalizeRfc8785(mutation), 'utf8')
      .digest('hex')
    expect(mutationDigest).not.toEqual(OPENAI_REQUEST_SHAPE_V1_DIGEST)
    expect(mutation).not.toEqual(OPENAI_REQUEST_SHAPE_V1)
  })
})
