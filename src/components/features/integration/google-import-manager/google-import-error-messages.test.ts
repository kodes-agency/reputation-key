import { describe, expect, it } from 'vitest'
import type { GoogleImportDiscoveryErrorCode } from '#/contexts/integration/application/google-import-discovery'
import { discoveryErrorMessage, startErrorMessage } from './google-import-error-messages'

/**
 * Only the code survives the server-fn boundary, so the client sees a plain coded
 * error rather than the thrown domain class.
 */
const coded = (code: string) => Object.assign(new Error(`failed: ${code}`), { code })

/**
 * `satisfies` makes the map exhaustive: a new discovery code without copy fails to
 * compile here instead of silently reaching the generic fallback at runtime.
 */
const EXPECTED_COPY = {
  unauthorized:
    'Your access changed. Refresh the page or ask an administrator for access.',
  invalid_request: 'The Google import service could not load this content.',
  reference_invalid:
    'This discovery page expired. Start again to fetch current locations.',
  reauthentication_required:
    'Google no longer accepts this connection. Reconnect Google to continue.',
  provider_rejected:
    'Google rejected the request for this account. Check that it still has access to these locations.',
  provider_unavailable:
    'Google Business Profile is temporarily unavailable. Try again shortly.',
  temporarily_unavailable:
    'Google Business Profile is temporarily unavailable. Try again shortly.',
} satisfies Record<GoogleImportDiscoveryErrorCode, string>

const TRANSIENT_COPY = EXPECTED_COPY.provider_unavailable

describe('discoveryErrorMessage', () => {
  it.each(Object.entries(EXPECTED_COPY))('maps %s to its own copy', (code, expected) => {
    expect(discoveryErrorMessage(coded(code))).toBe(expected)
  })

  it('never presents a permanent denial as a transient outage', () => {
    // The whole defect: both of these used to read "temporarily unavailable", so a
    // revoked credential or a refused account looked like a retryable blip.
    expect(discoveryErrorMessage(coded('reauthentication_required'))).not.toBe(
      TRANSIENT_COPY,
    )
    expect(discoveryErrorMessage(coded('provider_rejected'))).not.toBe(TRANSIENT_COPY)
  })

  it('tells the operator what to do next about the connection', () => {
    expect(discoveryErrorMessage(coded('reauthentication_required'))).toMatch(
      /reconnect google/i,
    )
    expect(discoveryErrorMessage(coded('provider_rejected'))).toMatch(
      /google rejected the request for this account/i,
    )
  })

  it('falls back to one generic message for an unknown or absent code', () => {
    const fallback = 'The Google import service could not load this content.'
    expect(discoveryErrorMessage(coded('some_future_code'))).toBe(fallback)
    expect(discoveryErrorMessage(new Error('no code at all'))).toBe(fallback)
    expect(discoveryErrorMessage(null)).toBe(fallback)
  })
})

describe('startErrorMessage', () => {
  it('keeps its own recovery-oriented copy for start failures', () => {
    expect(startErrorMessage(coded('request_conflict'))).toMatch(/already used/i)
    expect(startErrorMessage(coded('reauthentication_required'))).toMatch(/recover it/i)
  })
})
