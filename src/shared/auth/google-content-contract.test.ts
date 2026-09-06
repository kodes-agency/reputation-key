import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CONTENT_CAPABILITIES,
  GOOGLE_CONTENT_POLICY_VERSION,
  GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION,
  GOOGLE_OAUTH_CONTRACT_VERSION,
  cleanupOutcomeRequiresProviderReset,
  isCleanupOutcomeDrained,
} from './google-content-contract'

describe('Google Content contract', () => {
  it('freezes the independently killable capabilities and live versions', () => {
    expect(GOOGLE_CONTENT_CAPABILITIES).toEqual([
      'property.import_gbp_v2',
      'property.read_gbp_performance',
      'property.connect_gbp',
      'property.publish_reply',
    ])
    expect(GOOGLE_CONTENT_POLICY_VERSION).toBe('google-content-live-1')
    expect(GOOGLE_OAUTH_CONTRACT_VERSION).toBe('google-oauth-oidc-1')
    expect(GOOGLE_CONTENT_RUNTIME_ISOLATION_PROFILE_VERSION).toBe(
      'google-content-egress-1',
    )
  })

  it('treats only confirmed revocation as cleanup-drained', () => {
    expect(isCleanupOutcomeDrained('confirmed_revoked')).toBe(true)
    expect(isCleanupOutcomeDrained('confirmed_not_sent')).toBe(false)
    expect(isCleanupOutcomeDrained('cleanup_ambiguous')).toBe(false)
    expect(cleanupOutcomeRequiresProviderReset('confirmed_not_sent')).toBe(
      'provider_reset_required',
    )
    expect(cleanupOutcomeRequiresProviderReset('cleanup_ambiguous')).toBe('ambiguous')
    expect(cleanupOutcomeRequiresProviderReset('confirmed_revoked')).toBeNull()
  })
})
