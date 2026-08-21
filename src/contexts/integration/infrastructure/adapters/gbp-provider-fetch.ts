// Integration context — transport-failure classification for the direct-fetch
// GBP adapters (gbp-api, mybusiness-notifications).
//
// An unreachable provider — DNS gone, connection refused, socket reset, TLS
// rejected — produces no Response at all: `fetch` rejects with a raw
// `TypeError` ('fetch failed'). Letting that escape an adapter breaks two
// contracts. `isGbpApiError` is false, so callers branching on the taxonomy
// take the unclassified path. And `safeError` (shared/observability/logger)
// keeps only `name`, so the diagnostic operators receive on a provider-facing
// span reads `TypeError` — unattributable.
//
// The governed plane already classifies this at the transport boundary:
// `executeGoogleProviderRaw` maps any executor rejection to `upstream_error`,
// and the direct-fetch review adapter maps the identical rejection to its own
// retryable provider-outage kind. This is that same rule for the adapters that
// call `fetch` directly against the GBP taxonomy.

import { createGbpApiError } from '../../domain/gbp-api-error'

/**
 * `fetch`, with a transport rejection classified as `upstream_error` for
 * `operation`. HTTP status handling stays with the caller: a Response — of any
 * status — is returned untouched.
 */
export async function providerFetch(
  operation: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw createGbpApiError(operation, 'upstream_error')
  }
}
