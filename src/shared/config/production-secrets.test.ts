// Tests for the production placeholder-secret boot guard (BQC-7.6).
//
// Production must refuse to boot when secrets match the known placeholder/test
// family (test-environment.ts values, CI workflow placeholders, .env.example
// examples). Detection is exact-match + marker + low-entropy heuristics; the
// error names offending FIELDS only — never the matched values.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assertProductionSecrets, findPlaceholderSecrets } from './production-secrets'

const ENV_EXAMPLE = resolve(import.meta.dirname, '../../../.env.example')

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
  PORTAL_TOKEN_HASH_SECRET:
    'c3e5b7d9f0a2c4e6f8a0b2c4d6e8f1a3b5c7d9e0f2a4c6e8b1d3f5a7c9e0b2d4',
  REVIEW_PROVIDER_SUBJECT_HMAC_KEYS:
    'v1:9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f0',
  NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS:
    'v1:7b9d1f3a5c7e9b0d2f4a6c8e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e6b8d',
} as const

describe('findPlaceholderSecrets (BQC-7.6)', () => {
  it('accepts a real-looking production secret set', () => {
    expect(findPlaceholderSecrets(REAL)).toEqual([])
  })

  it('accepts a real Portal address keyring and flags a placeholder key behind a real one', () => {
    const real = `2:${'9f4c2e7a1b8d4e6f0a3c5b7d9e2f4a6c8b1d3e5f7a9c0e2b4d6f8a1c3e5b7d9f'.slice(0, 64)}`
    expect(
      findPlaceholderSecrets({ ...REAL, PORTAL_ADDRESS_ENCRYPTION_KEYS: real }),
    ).toEqual([])
    expect(
      findPlaceholderSecrets({
        ...REAL,
        PORTAL_ADDRESS_ENCRYPTION_KEYS: `${real},1:${'55'.repeat(32)}`,
      }),
    ).toEqual(['PORTAL_ADDRESS_ENCRYPTION_KEYS'])
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
      ['PORTAL_TOKEN_HASH_SECRET', 'dev-only-portal-token-secret-32b'],
      ['REVIEW_PROVIDER_SUBJECT_HMAC_KEYS', `v1:${'11'.repeat(32)}`],
      ['REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS', `initial:${'22'.repeat(32)}`],
      ['NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS', `v1:${'33'.repeat(32)}`],
      ['PORTAL_ADDRESS_ENCRYPTION_KEYS', `1:${'44'.repeat(32)}`],
      ['OPS_METRICS_TOKEN', 'e2e-ops-metrics-token-0123456789abcdef'],
      ['BETTER_AUTH_SECRET', 'replace-me-with-a-long-random-secret-min-32-chars'],
      // The .env.example Resend key: in production it switched notification
      // mail to capture, which reports every send as accepted.
      ['RESEND_API_KEY', 're_xxxxxxxxxxxx'],
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

  it('flags a low-entropy value in the Google, AI, mail-webhook and object-store secrets', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS', `v1:${'0'.repeat(64)}`],
      ['GOOGLE_SESSION_BINDING_HMAC_KEYS', `v1:${'0'.repeat(64)}`],
      ['GOOGLE_OPAQUE_REFERENCE_HMAC_KEYS', `v1:${'ab'.repeat(32)}`],
      ['GOOGLE_REPLAY_HMAC_KEYS', `v1:${'0'.repeat(64)}`],
      ['GOOGLE_ADMISSION_GRANT_HMAC_KEYS', `v1:${'11'.repeat(32)}`],
      ['GOOGLE_CREDENTIAL_BINDING_HMAC_KEYS', `v1:${'22'.repeat(32)}`],
      ['AI_SUBJECT_HMAC_KEYS', `subject-v1:${'33'.repeat(32)}`],
      ['AI_REQUEST_BINDING_HMAC_KEYS', `request-v1:${'44'.repeat(32)}`],
      ['AI_SAFETY_IDENTIFIER_HMAC_KEYS', `safety-v1:${'55'.repeat(32)}`],
      ['AI_ADMISSION_ED25519_PRIVATE_KEY_B64', 'A'.repeat(64)],
      ['AI_PROVENANCE_ED25519_PRIVATE_KEY_B64', 'A'.repeat(64)],
      ['RESEND_WEBHOOK_SECRET', 'whsec_placeholder'],
      ['AWS_S3_SECRET_ACCESS_KEY', 'x'.repeat(40)],
    ]
    for (const [field, value] of cases) {
      const flagged = findPlaceholderSecrets({ ...REAL, [field]: value })
      expect(flagged, `${field}=${value} must be flagged`).toEqual([field])
    }
  })

  it('accepts real values for the Google, AI, mail-webhook and object-store secrets', () => {
    expect(
      findPlaceholderSecrets({
        ...REAL,
        GOOGLE_OAUTH_STATE_HANDLE_HMAC_KEYS:
          'v2:03a192130b9752f95194131885523890b44b26387046660cb1161f96a56410c9',
        AI_SUBJECT_HMAC_KEYS:
          'subject-v1:bae857a2ccaa77786a33cca7939076b40db34123ba18d2568ae1e114b068d407',
        AI_ADMISSION_ED25519_PRIVATE_KEY_B64:
          'MC4CAQAwBQYDK2VwBCIEIJ1hsZ3v/VpguoRK9JLsLMREScVpezJpGXA7rAMcrn9g',
        RESEND_WEBHOOK_SECRET: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
        AWS_S3_SECRET_ACCESS_KEY: '6831f3f16002293886e31c0974fe7c8f',
      }),
    ).toEqual([])
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

  it('refuses the Portal token secret placeholder, naming the field not the value', () => {
    const secret = 'dev-only-portal-token-secret-32b'
    let caught: unknown
    try {
      assertProductionSecrets({ ...REAL, PORTAL_TOKEN_HASH_SECRET: secret })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('values: PORTAL_TOKEN_HASH_SECRET.')
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

describe('the environment schema (BQC-7.6)', () => {
  // The guard's field list is kept by hand beside a schema that grows. Six
  // Google keyrings, three AI keyrings, two AI signing keys, the mail-webhook
  // secret and the object-store secret were all in the schema and not in the
  // list. A field the schema names like a secret is inspected, or is listed
  // here with why it is not.
  const NOT_INSPECTED: Readonly<Record<string, string>> = {
    AWS_S3_ACCESS_KEY: 'an access key id; AWS_S3_SECRET_ACCESS_KEY is its secret',
    GOOGLE_OAUTH_TOKEN_URL: 'an address',
    SENTRY_AUTH_TOKEN:
      'the source-map upload credential of the build; the running app never reads it',
    OPENAI_API_KEY:
      'issued by the provider, which refuses any other value, and it signs nothing of ours; naming it here would make the guard a second reader of a key that only the module that builds the client may read (provider-client-singleton.test.ts)',
  }
  const isSecretName = (name: string) =>
    /SECRET|SALT|TOKEN|PRIVATE_KEY/.test(name) || /_KEYS?$/.test(name)
  const schemaFields = [
    ...readFileSync(resolve(import.meta.dirname, 'env.ts'), 'utf8').matchAll(
      /^ {2}([A-Z][A-Z0-9_]*): /gm,
    ),
  ].flatMap((match) => (match[1] ? [match[1]] : []))

  it('reads the schema', () => {
    expect(schemaFields).toContain('BETTER_AUTH_SECRET')
    expect(schemaFields).toContain('AI_PROVENANCE_ED25519_PRIVATE_KEY_B64')
    expect(schemaFields.filter((name) => name in NOT_INSPECTED).sort()).toEqual(
      Object.keys(NOT_INSPECTED).sort(),
    )
  })

  it('inspects every field the schema names like a secret', () => {
    const uninspected = schemaFields
      .filter((name) => isSecretName(name) && !(name in NOT_INSPECTED))
      .filter((name) => {
        const lowEntropy = name.endsWith('_KEYS')
          ? `v1:${'0'.repeat(64)}`
          : '0'.repeat(64)
        return !findPlaceholderSecrets({
          NODE_ENV: 'production',
          [name]: lowEntropy,
        }).includes(name)
      })

    expect(uninspected).toEqual([])
  })
})

describe('.env.example secrets (BQC-7.6)', () => {
  // A secret added to env.ts and .env.example but not to the guard's field
  // list boots production on a public value when the example is copied into a
  // deployment (PORTAL_TOKEN_HASH_SECRET was missed exactly this way).
  it('flags every active example secret', () => {
    const secrets = readFileSync(ENV_EXAMPLE, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const match = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line.trim())
        if (!match) return []
        const name = match[1]
        // A secret-bearing name contains SECRET/SALT/TOKEN anywhere, or ends
        // in _KEY/_KEYS (two tests, so the anchor applies to the suffix only).
        const isSecretName = /SECRET|SALT|TOKEN/.test(name) || /_KEYS?$/.test(name)
        if (!isSecretName) return []
        return [[name, match[2]] as const]
      })
    expect(secrets.map(([key]) => key)).toContain('PORTAL_TOKEN_HASH_SECRET')
    for (const [key, value] of secrets) {
      expect(
        findPlaceholderSecrets({ NODE_ENV: 'production', [key]: value }),
        `${key} in .env.example must be flagged`,
      ).toEqual([key])
    }
  })
})
