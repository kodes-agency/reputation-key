// Unit tests for isDarkCapabilityDenial (BQC-6.7 / F-PEOPLE).
import { describe, expect, it } from 'vitest'
import { isDarkCapabilityDenial } from './capability-denial'
import { ServerFunctionError } from './server-function-error'

describe('isDarkCapabilityDenial', () => {
  it('matches the dark-capability deny reasons', () => {
    for (const code of ['capability_disabled', 'capability_blocked']) {
      expect(
        isDarkCapabilityDenial(new ServerFunctionError('AuthError', 'denied', code, 403)),
      ).toBe(true)
    }
  })

  it('matches the plain serialized shape (client-navigation path)', () => {
    expect(isDarkCapabilityDenial({ code: 'capability_disabled' })).toBe(true)
  })

  it('does NOT match real errors or other codes', () => {
    expect(
      isDarkCapabilityDenial(
        new ServerFunctionError('InternalError', 'boom', 'internal_error', 500),
      ),
    ).toBe(false)
    expect(
      isDarkCapabilityDenial(
        new ServerFunctionError('AuthError', 'x', 'org_suspended', 403),
      ),
    ).toBe(false)
    expect(isDarkCapabilityDenial(new Error('capability_disabled'))).toBe(false)
    expect(isDarkCapabilityDenial(new TypeError('Failed to fetch'))).toBe(false)
    expect(isDarkCapabilityDenial(null)).toBe(false)
    expect(isDarkCapabilityDenial(undefined)).toBe(false)
    expect(isDarkCapabilityDenial('capability_disabled')).toBe(false)
    expect(isDarkCapabilityDenial({ code: 42 })).toBe(false)
  })
})
