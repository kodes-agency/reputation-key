import { describe, expect, it } from 'vitest'
import { testEnvironment } from '#/shared/testing/test-environment'
import { parseEnvironment } from './env'

const productionEnvironment = {
  ...testEnvironment({}),
  NODE_ENV: 'production' as const,
  BETTER_AUTH_URL: 'https://app.reputationkey.app',
}

describe('environment parsing', () => {
  it('refuses production startup without an explicit processing cell', () => {
    expect(() => parseEnvironment(productionEnvironment)).toThrow(
      'Production deployments require an explicit PROCESSING_CELL',
    )
  })

  it('retains the deliberate US default for local and test environments', () => {
    expect(parseEnvironment(testEnvironment({})).PROCESSING_CELL).toBe('us')
  })

  it('accepts only the beta-deployable US cell in production', () => {
    expect(
      parseEnvironment({ ...productionEnvironment, PROCESSING_CELL: 'us' })
        .PROCESSING_CELL,
    ).toBe('us')
    expect(() =>
      parseEnvironment({ ...productionEnvironment, PROCESSING_CELL: 'europe' }),
    ).toThrow('Production deployments require a beta-deployable PROCESSING_CELL (us)')
    expect(() =>
      parseEnvironment({ ...productionEnvironment, PROCESSING_CELL: 'global' }),
    ).toThrow('Production deployments require a beta-deployable PROCESSING_CELL (us)')
  })

  it('admits Review recovery approval authority only as a complete isolated-restore tuple', () => {
    const authority = {
      REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: '{}\n',
      REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256: 'a'.repeat(64),
      REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON: '{"key":"value"}',
    }
    expect(() => parseEnvironment({ ...testEnvironment({}), ...authority })).toThrow(
      /allowed only in restore-isolated mode/,
    )
    expect(() =>
      parseEnvironment({
        ...testEnvironment({}),
        RESTORE_MODE: 'isolated',
        PROCESSING_CELL: 'us',
        RESTORE_SOURCE_CELL: 'us',
        ...authority,
      }),
    ).not.toThrow()
    expect(() =>
      parseEnvironment({
        ...testEnvironment({}),
        RESTORE_MODE: 'isolated',
        PROCESSING_CELL: 'us',
        RESTORE_SOURCE_CELL: 'us',
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON:
          authority.REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON,
      }),
    ).toThrow(/must be configured together/)
  })

  it('refuses empty Review recovery approval artifacts', () => {
    expect(() =>
      parseEnvironment({
        ...testEnvironment({}),
        RESTORE_MODE: 'isolated',
        PROCESSING_CELL: 'us',
        RESTORE_SOURCE_CELL: 'us',
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: '',
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256: 'a'.repeat(64),
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON: '',
      }),
    ).toThrow(/REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: Too small/)
  })
})

describe('production auth transport policy', () => {
  const cell = { ...productionEnvironment, PROCESSING_CELL: 'us' as const }

  it('refuses a plaintext auth origin that can be reached over a network', () => {
    // The reason the rule exists: a production auth origin decides
    // trusted-origin checks, callback URLs and the Secure attribute on session
    // cookies. On a routable host, http means those cookies are eligible for
    // plaintext transport.
    for (const origin of [
      'http://app.reputationkey.app',
      'http://10.0.0.5:3000',
      'http://beta.internal',
      // Not loopback, however much it looks like it.
      'http://localhost.attacker.test',
      'http://127.0.0.1.attacker.test',
    ]) {
      expect(() => parseEnvironment({ ...cell, BETTER_AUTH_URL: origin })).toThrow(
        'Production BETTER_AUTH_URL must use HTTPS',
      )
    }
  })

  it('allows a LOOPBACK origin, because there is no transport to protect', () => {
    // The local Compose stack runs the production images against
    // http://127.0.0.1:3000 — traffic that never leaves the machine, which is
    // why browsers treat loopback as a potentially-trustworthy origin too.
    for (const origin of [
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://[::1]:3000',
      'http://web.localhost:3000',
    ]) {
      expect(parseEnvironment({ ...cell, BETTER_AUTH_URL: origin }).BETTER_AUTH_URL).toBe(
        origin,
      )
    }
  })

  it('still prefers HTTPS, and accepts it anywhere', () => {
    expect(
      parseEnvironment({ ...cell, BETTER_AUTH_URL: 'https://app.reputationkey.app' })
        .BETTER_AUTH_URL,
    ).toBe('https://app.reputationkey.app')
  })
})
