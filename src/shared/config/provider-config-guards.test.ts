// Production fail-closed provider config guards.
//
// Both guards must be INERT outside production — the canonical test env and a
// developer's .env leave every one of these fields unset on purpose, and a
// guard that fired there would make every local worker and every test red.

import { describe, it, expect } from 'vitest'
import {
  GOOGLE_EGRESS_CONFIG_FIELDS,
  GOOGLE_EGRESS_LEGACY_PATH_FIELDS,
  type ProviderConfigError,
  assertDirectCredentialEgressAllowed,
  assertReviewProviderSubjectKeysConfigured,
  isProviderConfigError,
  missingGoogleEgressConfig,
} from './provider-config-guards'

const CONFIGURED_EGRESS = Object.fromEntries(
  GOOGLE_EGRESS_CONFIG_FIELDS.map((field) => [field, `configured-${field}`]),
) as Record<(typeof GOOGLE_EGRESS_CONFIG_FIELDS)[number], string>

/**
 * Run `guard` and return the ProviderConfigError it threw. Asserts the tagged
 * shape AND that it is a real Error — the ADR 0005 hybrid is what makes a boot
 * refusal show up with a stack instead of `[object Object]` in the logs.
 */
function refusalFrom(guard: () => void): ProviderConfigError {
  let thrown: unknown
  try {
    guard()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(Error)
  expect(isProviderConfigError(thrown)).toBe(true)
  return thrown as ProviderConfigError
}

describe('assertReviewProviderSubjectKeysConfigured', () => {
  it('refuses a production worker with the keyring unset, naming the variable', () => {
    const error = refusalFrom(() =>
      assertReviewProviderSubjectKeysConfigured({ NODE_ENV: 'production' }, true),
    )

    expect(error._tag).toBe('ProviderConfigError')
    expect(error.code).toBe('config_invalid')
    expect(error.missing).toEqual(['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS'])
    expect(error.message).toContain('REVIEW_PROVIDER_SUBJECT_HMAC_KEYS')
    expect(error.message).toContain('acquireDeriver()')
  })

  it('refuses an empty-string keyring the same way as an absent one', () => {
    const error = refusalFrom(() =>
      assertReviewProviderSubjectKeysConfigured(
        { NODE_ENV: 'production', REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: '' },
        true,
      ),
    )

    expect(error.missing).toEqual(['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS'])
  })

  it('allows a production worker whose keyring is configured', () => {
    expect(() =>
      assertReviewProviderSubjectKeysConfigured(
        {
          NODE_ENV: 'production',
          REVIEW_PROVIDER_SUBJECT_HMAC_KEYS: `v1:${'a'.repeat(64)}`,
        },
        true,
      ),
    ).not.toThrow()
  })

  it('stays quiet for a production process that does not run jobs', () => {
    // The web container must NOT carry this material — composition rejects it
    // there — so the guard must not demand it.
    expect(() =>
      assertReviewProviderSubjectKeysConfigured({ NODE_ENV: 'production' }, false),
    ).not.toThrow()
  })

  it('stays quiet in development and test even with jobs enabled', () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(() =>
        assertReviewProviderSubjectKeysConfigured(
          { ...(NODE_ENV && { NODE_ENV }) },
          true,
        ),
      ).not.toThrow()
    }
  })
})

describe('missingGoogleEgressConfig', () => {
  it('reports every unset field, in declaration order', () => {
    expect(missingGoogleEgressConfig({})).toEqual(GOOGLE_EGRESS_CONFIG_FIELDS)
  })

  it('reports nothing when all six are configured', () => {
    expect(missingGoogleEgressConfig(CONFIGURED_EGRESS)).toEqual([])
  })

  it('reports only the gaps in a partial configuration', () => {
    const partial = { ...CONFIGURED_EGRESS, GOOGLE_INTERNAL_MTLS_KEY_B64: '' }
    expect(missingGoogleEgressConfig(partial)).toEqual(['GOOGLE_INTERNAL_MTLS_KEY_B64'])
  })

  it('accepts the complete legacy path triplet during the cutover window', () => {
    const legacy = {
      GOOGLE_EGRESS_GATEWAY_ORIGIN: 'https://gateway.internal:8443',
      GOOGLE_EGRESS_GATEWAY_SERVER_NAME: 'gateway.internal',
      GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS: 'v1:key',
      ...Object.fromEntries(
        GOOGLE_EGRESS_LEGACY_PATH_FIELDS.map((field) => [field, `/run/${field}`]),
      ),
    }
    expect(missingGoogleEgressConfig(legacy)).toEqual([])
  })
})

describe('assertDirectCredentialEgressAllowed', () => {
  it('has no production escape hatch for OAuth credentials', () => {
    const error = refusalFrom(() =>
      assertDirectCredentialEgressAllowed(
        {
          NODE_ENV: 'production',
          GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS: true,
          ...CONFIGURED_EGRESS,
        },
        'oauth.token.refresh',
      ),
    )

    expect(error.missing).toEqual([])
    expect(error.message).toContain('oauth.token.refresh')
    expect(error.message).toContain('credential gateway')
    expect(error.message).not.toContain('GOOGLE_ALLOW_DIRECT_PROVIDER_EGRESS=true')
  })

  it('stays quiet outside production for deterministic local adapters', () => {
    expect(() =>
      assertDirectCredentialEgressAllowed({ NODE_ENV: 'test' }, 'oauth.token.exchange'),
    ).not.toThrow()
  })
})
