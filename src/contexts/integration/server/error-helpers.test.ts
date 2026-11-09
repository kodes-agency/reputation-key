import { describe, it, expect } from 'vitest'
import type { IntegrationErrorCode } from '../domain/errors'
import { integrationErrorStatus } from './error-helpers'

describe('integrationErrorStatus', () => {
  it('maps known error codes to HTTP statuses', () => {
    expect(integrationErrorStatus('forbidden')).toBe(403)
    expect(integrationErrorStatus('connection_not_found')).toBe(404)
    expect(integrationErrorStatus('import_not_found')).toBe(404)
    expect(integrationErrorStatus('oauth_failed')).toBe(400)
    expect(integrationErrorStatus('gbp_api_rate_limited')).toBe(429)
    expect(integrationErrorStatus('connection_disconnected')).toBe(409)
    // A connection waiting for a fresh consent conflicts with the request in
    // the same way a disconnected one does; it is not a bad request.
    expect(integrationErrorStatus('reauthorization_required')).toBe(409)
  })

  it.each<[IntegrationErrorCode, number]>([
    ['forbidden', 403],
    ['connection_not_found', 404],
    ['import_not_found', 404],
    ['connection_inactive', 409],
    ['connection_disconnected', 409],
    ['account_already_connected', 409],
    ['reauthorization_required', 409],
    ['invalid_transition', 409],
    ['region_unresolved', 409],
    ['oauth_failed', 400],
    ['oauth_denied', 400],
    ['scope_not_granted', 400],
    ['oauth_state_invalid', 400],
    ['token_refresh_failed', 400],
    ['gbp_api_error', 400],
    ['invalid_visibility', 400],
    ['encryption_error', 400],
    ['invalid_cache_entry', 400],
    ['invalid_event', 400],
    ['gbp_api_rate_limited', 429],
  ])('answers %s with HTTP %i', (code, status) => {
    expect(integrationErrorStatus(code)).toBe(status)
  })
})
