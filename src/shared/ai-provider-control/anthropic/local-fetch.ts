import { createProviderForwardFetch } from '../connector-boundary'
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_USER_AGENT,
} from './request-profile'

const LOCAL_ANTHROPIC_MESSAGES_URL = 'http://ai-provider-stub:4102/v1/messages'

function assertAnthropicLocalHeaders(headers: Headers): void {
  if (
    [...headers.entries()].length !== 5 ||
    headers.get('accept') !== 'application/json' ||
    headers.get('anthropic-version') !== ANTHROPIC_API_VERSION ||
    headers.get('content-type') !== 'application/json' ||
    headers.get('user-agent') !== ANTHROPIC_USER_AGENT ||
    (headers.get('x-api-key')?.length ?? 0) < 1
  ) {
    throw new TypeError('Local Anthropic provider request headers are invalid')
  }
}

/** Local-stack transport with one compile-time destination and no env override. */
export function createLocalAnthropicProviderFetch(): typeof fetch {
  return createProviderForwardFetch({
    logicalUrl: ANTHROPIC_MESSAGES_URL,
    destinationUrl: LOCAL_ANTHROPIC_MESSAGES_URL,
    assertHeaders: assertAnthropicLocalHeaders,
    invalidError: () => new TypeError('Local Anthropic provider destination is invalid'),
    invalidBodyError: () =>
      new TypeError('Local Anthropic provider request body is invalid'),
  })
}
