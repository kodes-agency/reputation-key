import { describe, it, expect } from 'vitest'
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
})
