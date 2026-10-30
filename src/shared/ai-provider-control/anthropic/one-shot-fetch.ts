import {
  createOneShotProviderFetch,
  type OneShotProviderFetchState,
} from '../connector-boundary'
import { parseOpenAiJsonContentType, parseOpenAiRetryAfter } from '../dispositions'
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_SDK_TIMEOUT_MILLIS,
  ANTHROPIC_SDK_VERSION,
  ANTHROPIC_USER_AGENT,
} from './request-profile'

export class AmbiguousAnthropicTransportError extends Error {
  constructor() {
    super('Anthropic transport outcome is ambiguous')
    this.name = 'AmbiguousAnthropicTransportError'
  }
}

export class InvalidAnthropicOutputError extends Error {
  readonly reason: string

  constructor(reason = 'unspecified') {
    super('Anthropic output is invalid')
    this.name = 'InvalidAnthropicOutputError'
    this.reason = reason
  }
}

export class InvalidAnthropicRequestError extends Error {
  constructor() {
    super('Anthropic request is invalid')
    this.name = 'InvalidAnthropicRequestError'
  }
}

export type OneShotAnthropicFetchState = OneShotProviderFetchState

export function expectedPinnedAnthropicSdkHeaders(
  apiKey: string,
): Readonly<Record<string, string>> {
  const os =
    process.platform === 'linux'
      ? 'Linux'
      : process.platform === 'darwin'
        ? 'MacOS'
        : null
  if (os === null || (process.arch !== 'arm64' && process.arch !== 'x64')) {
    throw new InvalidAnthropicRequestError()
  }
  return Object.freeze({
    accept: 'application/json',
    'anthropic-version': ANTHROPIC_API_VERSION,
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': `Anthropic/JS ${ANTHROPIC_SDK_VERSION}`,
    'x-stainless-arch': process.arch,
    'x-stainless-lang': 'js',
    'x-stainless-os': os,
    'x-stainless-package-version': ANTHROPIC_SDK_VERSION,
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
    'x-stainless-timeout': String(Math.trunc(ANTHROPIC_SDK_TIMEOUT_MILLIS / 1_000)),
  })
}

export function createOneShotAnthropicFetch(
  input: Readonly<{
    route?: string
    apiKey: string
    permitId: string
    canonicalProviderBytes: Uint8Array
    responseBytes: number
    outboundFetch: typeof fetch
    signal: AbortSignal
  }>,
): Readonly<{
  fetch: typeof fetch
  state: OneShotAnthropicFetchState
  dispose(): void
}> {
  if (input.permitId.length === 0) throw new InvalidAnthropicRequestError()
  return createOneShotProviderFetch({
    apiKey: input.apiKey,
    url: ANTHROPIC_MESSAGES_URL,
    canonicalProviderBytes: input.canonicalProviderBytes,
    responseBytes: input.responseBytes,
    outboundFetch: input.outboundFetch,
    signal: input.signal,
    expectedSdkHeaders: expectedPinnedAnthropicSdkHeaders,
    outboundHeaders: () =>
      new Headers({
        'x-api-key': input.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': ANTHROPIC_USER_AGENT,
      }),
    invalidError: () => new InvalidAnthropicRequestError(),
    ambiguousError: () => new AmbiguousAnthropicTransportError(),
    invalidOutputError: (reason) => new InvalidAnthropicOutputError(reason),
    parseRetryAfter: parseOpenAiRetryAfter,
    validJsonContentType: parseOpenAiJsonContentType,
  })
}
