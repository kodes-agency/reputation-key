// Tests for the production placeholder-secret boot guard (BQC-7.6).
//
// Production must refuse to boot when secrets match the known placeholder/test
// family (test-environment.ts values, CI workflow placeholders, .env.example
// examples). Detection is exact-match + marker + low-entropy heuristics; the
// error names offending FIELDS only — never the matched values.

import { describe, it, expect } from 'vitest'
import { assertProductionSecrets, findPlaceholderSecrets } from './production-secrets'

const REAL = {
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET:
    '9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f0a2',
  RESEND_API_KEY: 're_9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c',
  GOOGLE_CLIENT_ID:
    '817263549012-abc9def0a1b2c3d4e5f6a7b8c9d0e1f2.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-9f4c2e7a1b8d4e6f0a3c5b7d',
  ENCRYPTION_KEY:
    '9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e',
  OAUTH_STATE_SECRET:
    '4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6f8a0b2c4d',
  GUEST_SESSION_SALT: 'f4a6c8b1d3e5f7a9c0e2b4d6',
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS:
    'v1:9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f0',
  NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS:
    'v1:7b9d1f3a5c7e9b0d2f4a6c8e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d',
} as const

describe('findPlaceholderSecrets (BQC-7.6)', () => {
  it('accepts a real-looking production secret set', () => {
    expect(findPlaceholderSecrets(REAL)).toEqual([])
  })

  it('flags the CI/test placeholder family', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['BETTER_AUTH_SECRET', 'test-secret-at-least-32-characters-long-for-ci'],
      ['BETTER_AUTH_SECRET', 'test-test-test-test-test-test-test-test'],
      ['RESEND_API_KEY', 're_ci_test_key_placeholder'],
      ['RESEND_API_KEY', 're_test_key_for_testing_only'],
      ['GOOGLE_CLIENT_ID', 'ci-placeholder-client-id'],
      ['GOOGLE_CLIENT_SECRET', 'ci-placeholder-client-secret'],
      ['GOOGLE_CLIENT_ID', 'xxxxxxxx.apps.googleusercontent.com'],
      ['GOOGLE_CLIENT_SECRET', 'GOCSPX-xxxxxxxxxxxxxxxxxxxx'],
      [
        'ENCRYPTION_KEY',
        'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
      ],
      ['OAUTH_STATE_SECRET', 'aabbccddaabbccddaabbccddaabbccdd'],
      [
        'OAUTH_STATE_SECRET',
        'abababababababababababababababababababababababababababababababab',
      ],
      ['GUEST_SESSION_SALT', 'dev-only-salt-not-for-production'],
      ['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS', `v1:${'11'.repeat(32)}`],
      ['REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS', `initial:${'22'.repeat(32)}`],
      ['NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS', `v1:${'33'.repeat(32)}`],
      ['OPS_METRICS_TOKEN', 'e2e-ops-metrics-token-0123456789abcdef'],
      ['BETTER_AUTH_SECRET', 'replace-me-with-a-long-random-secret-min-32-chars'],
    ]
    for (const [field, value] of cases) {
      const flagged = findPlaceholderSecrets({ ...REAL, [field]: value })
      expect(flagged, `${field}=${value} must be flagged`).toContain(field)
    }
  })

  it('flags low-entropy repeated-character secrets', () => {
    expect(findPlaceholderSecrets({ ...REAL, ENCRYPTION_KEY: 'a'.repeat(64) })).toContain(
      'ENCRYPTION_KEY',
    )
    expect(findPlaceholderSecrets({ ...REAL, ENCRYPTION_KEY: '0'.repeat(64) })).toContain(
      'ENCRYPTION_KEY',
    )
  })

  it('collects every offending field at once', () => {
    const flagged = findPlaceholderSecrets({
      ...REAL,
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long-for-ci',
      GOOGLE_CLIENT_ID: 'ci-placeholder-client-id',
    })
    expect(flagged).toContain('BETTER_AUTH_SECRET')
    expect(flagged).toContain('GOOGLE_CLIENT_ID')
    expect(flagged).toHaveLength(2)
  })
})

describe('assertProductionSecrets (BQC-7.6)', () => {
  it('throws in production when a placeholder is present, naming fields not values', () => {
    const secret = 'test-secret-at-least-32-characters-long-for-ci'
    let caught: unknown
    try {
      assertProductionSecrets({ ...REAL, BETTER_AUTH_SECRET: secret })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('BETTER_AUTH_SECRET')
    expect((caught as Error).message).not.toContain(secret)
  })

  it('passes in production with a real secret set', () => {
    expect(() => assertProductionSecrets(REAL)).not.toThrow()
  })

  it('is a no-op outside production (tests/dev boot with placeholders)', () => {
    const allPlaceholders = {
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long-for-ci',
      RESEND_API_KEY: 're_ci_test_key_placeholder',
      GOOGLE_CLIENT_ID: 'ci-placeholder-client-id',
      GOOGLE_CLIENT_SECRET: 'ci-placeholder-client-secret',
      ENCRYPTION_KEY: 'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
      OAUTH_STATE_SECRET: 'aabbccddaabbccddaabbccddaabbccdd',
      GUEST_SESSION_SALT: 'dev-only-salt-not-for-production',
    }
    expect(() => assertProductionSecrets(allPlaceholders)).not.toThrow()
    expect(() =>
      assertProductionSecrets({ ...allPlaceholders, NODE_ENV: 'development' }),
    ).not.toThrow()
  })
})
