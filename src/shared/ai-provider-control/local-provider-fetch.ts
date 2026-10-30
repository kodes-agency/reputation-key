import {
  OPENAI_RESPONSES_URL,
  OPENAI_USER_AGENT,
} from '#/shared/ai-provider-control/contracts'
import { createProviderForwardFetch } from './connector-boundary'

const LOCAL_PROVIDER_RESPONSES_URL = 'http://ai-provider-stub:4102/v1/responses'
const CLIENT_REQUEST_ID = /^rk_ai_[A-Za-z0-9_-]{43}$/u

function assertHeaders(headers: Headers): void {
  const entries = [...headers.entries()]
  if (
    entries.length !== 5 ||
    headers.get('accept') !== 'application/json' ||
    headers.get('content-type') !== 'application/json' ||
    headers.get('user-agent') !== OPENAI_USER_AGENT ||
    !headers.get('authorization')?.startsWith('Bearer ') ||
    !CLIENT_REQUEST_ID.test(headers.get('x-client-request-id') ?? '')
  ) {
    throw new TypeError('Local AI provider request headers are invalid')
  }
}

/**
 * Local-stack transport. It accepts only the connector's compiled logical
 * OpenAI URL and forwards to one compile-time stub address.
 *
 * NO ENVIRONMENT VALUE CAN SELECT ITS DESTINATION. That invariant is why this
 * takes no origin argument. Before WP2.3 it was enforced structurally: the stub
 * path was reachable only by building a separate sidecar entrypoint, so no
 * deployed configuration could reach it. In-process there is no second
 * entrypoint, so selection had to become configuration — and the first draft of
 * that made the destination itself an env-supplied URL, which would have let one
 * leaked variable send the provider key and merchant content to an arbitrary
 * host. The destination stays compiled in; the environment can only choose
 * between this transport and the pinned real one, and `ai-egress-runtime.ts`
 * refuses even that choice in a deployed cell.
 */
export function createLocalAiProviderFetch(): typeof fetch {
  return createProviderForwardFetch({
    logicalUrl: OPENAI_RESPONSES_URL,
    destinationUrl: LOCAL_PROVIDER_RESPONSES_URL,
    assertHeaders,
    invalidError: () => new TypeError('Local AI provider destination is invalid'),
    invalidBodyError: () => new TypeError('Local AI provider request body is invalid'),
  })
}
