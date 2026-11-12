import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod/v4'
import {
  PINNED_PROVIDER_DISPATCHER_LIMITS,
  closePinnedProviderOutbound,
  createPinnedProviderOutbound,
  createRestrictedProviderLookup,
  isForbiddenProviderAddress,
  type PinnedProviderOutbound,
  type ProviderDnsLookupAll,
} from '../connector-boundary'
import {
  outcomeOfProviderThrow,
  refusalAtProviderDispatchGate,
} from '../connector-outcomes'
import type { AiExecutionAdmission } from '../execution-admission'
import type { AiProviderConnection, AiProviderOutcome } from '../provider-contracts'
import { classifyAnthropicRefusal } from './dispositions'
import {
  InvalidAnthropicOutputError,
  InvalidAnthropicRequestError,
  createOneShotAnthropicFetch,
} from './one-shot-fetch'
import type { PreparedAnthropicInvocation } from './prepared-invocation'
import { interpretAnthropicMessage } from './response-interpreter'
import {
  ANTHROPIC_HOSTNAME,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_SDK_TIMEOUT_MILLIS,
} from './request-profile'
import { anthropicUsageOfDecodedBody } from './usage'

export type AnthropicConnector = AiProviderConnection<PreparedAnthropicInvocation>
export type PinnedAnthropicOutbound = PinnedProviderOutbound

type AnthropicConnectorDependencies = Readonly<{
  apiKey: string
  outboundFetch?: typeof fetch
  now?: () => number
  pinnedOutboundFactory?: () => PinnedAnthropicOutbound
}>

export function isForbiddenAnthropicAddress(address: string): boolean {
  return isForbiddenProviderAddress(address)
}

export function createRestrictedAnthropicLookup(lookupAll?: ProviderDnsLookupAll) {
  return createRestrictedProviderLookup({
    hostname: ANTHROPIC_HOSTNAME,
    label: 'Anthropic',
    ...(lookupAll === undefined ? {} : { lookupAll }),
  })
}

export const PINNED_ANTHROPIC_DISPATCHER_LIMITS = PINNED_PROVIDER_DISPATCHER_LIMITS

function createPinnedAnthropicOutboundFetch(): PinnedAnthropicOutbound {
  return createPinnedProviderOutbound({
    url: ANTHROPIC_MESSAGES_URL,
    hostname: ANTHROPIC_HOSTNAME,
    label: 'Anthropic',
    invalidError: () => new InvalidAnthropicRequestError(),
  })
}

function mutableSdkRequest(
  invocation: PreparedAnthropicInvocation,
): Anthropic.MessageCreateParamsNonStreaming {
  return JSON.parse(
    JSON.stringify(invocation.sdkRequest),
  ) as Anthropic.MessageCreateParamsNonStreaming
}

function anthropicSdkClient(apiKey: string, fetch: typeof globalThis.fetch): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: 'https://api.anthropic.com',
    maxRetries: 0,
    timeout: ANTHROPIC_SDK_TIMEOUT_MILLIS,
    fetch,
    logLevel: 'off',
    logger: { error() {}, warn() {}, info() {}, debug() {} },
    openTelemetry: false,
  })
}

export function createAnthropicConnector(
  dependencies: AnthropicConnectorDependencies,
): AnthropicConnector {
  if (dependencies.apiKey.length === 0) {
    throw new Error('An Anthropic API key is required')
  }
  const now = dependencies.now ?? Date.now
  let cleanupHealthy = true
  return Object.freeze({
    invoke: async (
      invocation: PreparedAnthropicInvocation,
      admission: AiExecutionAdmission,
      _outputSchema: z.ZodTypeAny,
      signal: AbortSignal,
    ): Promise<AiProviderOutcome<unknown>> => {
      const gateRefusal = refusalAtProviderDispatchGate({
        invocation,
        admission,
        now,
      })
      if (gateRefusal !== null) return gateRefusal
      let pinned: PinnedAnthropicOutbound | null = null
      let boundary: ReturnType<typeof createOneShotAnthropicFetch> | null = null
      try {
        pinned = dependencies.outboundFetch
          ? null
          : (dependencies.pinnedOutboundFactory ?? createPinnedAnthropicOutboundFetch)()
        const outboundFetch = dependencies.outboundFetch ?? pinned?.fetch
        if (outboundFetch === undefined) throw new InvalidAnthropicRequestError()
        boundary = createOneShotAnthropicFetch({
          route: invocation.descriptor.route,
          apiKey: dependencies.apiKey,
          permitId: admission.permitId,
          canonicalProviderBytes: invocation.canonicalProviderBytes,
          responseBytes: admission.limits.responseBytes,
          outboundFetch,
          signal,
        })
        const client = anthropicSdkClient(dependencies.apiKey, boundary.fetch)
        const response = await client.messages.create(mutableSdkRequest(invocation), {
          signal,
        })
        return interpretAnthropicMessage(
          response,
          invocation,
          admission.limits.responseBytes,
        )
      } catch (error) {
        return outcomeOfProviderThrow({
          error,
          state: boundary?.state ?? null,
          pinnedAbsent: pinned === null,
          invocation,
          responseBytes: admission.limits.responseBytes,
          signal,
          classifyRefusal: classifyAnthropicRefusal,
          isInvalidOutput: (value) => value instanceof InvalidAnthropicOutputError,
          usageOfDecodedBody: (bytes) => anthropicUsageOfDecodedBody(bytes, invocation),
        })
      } finally {
        boundary?.dispose()
        invocation.canonicalProviderBytes.fill(0)
        if (
          pinned !== null &&
          !(await closePinnedProviderOutbound(pinned, 'Anthropic'))
        ) {
          cleanupHealthy = false
        }
      }
    },
    readiness: () => cleanupHealthy,
  })
}
