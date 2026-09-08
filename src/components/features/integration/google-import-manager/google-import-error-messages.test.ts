import { describe, expect, it } from 'vitest'
import type { GoogleImportDiscoveryErrorCode } from '#/contexts/integration/application/google-import-discovery'
import type { GoogleImportTransactionErrorCode } from '#/contexts/integration/application/google-import-transaction'
import {
  connectionCallbackErrorMessage,
  discoveryErrorIsRecoverable,
  discoveryErrorMessage,
  startErrorMessage,
} from './google-import-error-messages'

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

  // The shape that actually reaches the browser on a client-side navigation is
  // the seroval-deserialized plain object, not an Error instance (see
  // `#/shared/auth/capability-denial.ts`). Guarding on `instanceof Error` threw
  // the server's classification away and showed the generic sentence for every
  // classified failure.
  it('reads the code from a deserialized server error, not just an Error', () => {
    expect(
      discoveryErrorMessage({
        name: 'GoogleImportDiscoveryError',
        code: 'reference_invalid',
        message: 'Google import discovery failed: reference_invalid',
      }),
    ).toMatch(/expired/i)
  })

  it('recovers the code from the message the server actually sends', () => {
    expect(
      discoveryErrorMessage(
        new Error('Google import discovery failed: reauthentication_required'),
      ),
    ).toMatch(/reconnect google/i)
  })

  it('offers a restart only for failures a fresh discovery clears', () => {
    expect(discoveryErrorIsRecoverable({ code: 'reference_invalid' })).toBe(true)
    expect(discoveryErrorIsRecoverable({ code: 'temporarily_unavailable' })).toBe(true)
    expect(discoveryErrorIsRecoverable({ code: 'provider_rejected' })).toBe(false)
    expect(discoveryErrorIsRecoverable({ code: 'reauthentication_required' })).toBe(false)
    expect(discoveryErrorIsRecoverable(null)).toBe(false)
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

  it('does not present a permanent contract rejection as retryable', () => {
    const code = 'contract_rejected' satisfies GoogleImportTransactionErrorCode
    const message = startErrorMessage(coded(code))

    expect(message).toMatch(/contact support/i)
    expect(message).toMatch(/cannot be retried/i)
    expect(message).not.toMatch(/recover it|try again|try shortly/i)
  })
})

describe('connectionCallbackErrorMessage', () => {
  it('keeps callback outcomes distinct and has no message without an error', () => {
    expect(connectionCallbackErrorMessage('account_already_connected')).toMatch(
      /already connected/i,
    )
    expect(connectionCallbackErrorMessage('denied')).toMatch(/cancelled/i)
    expect(connectionCallbackErrorMessage('connection_failed')).toMatch(/failed/i)
    expect(connectionCallbackErrorMessage(undefined)).toBeNull()
  })
})
