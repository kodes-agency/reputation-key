import { describe, expect, it } from 'vitest'
import { testEnvironment } from '#/shared/testing/test-environment'
import { parseEnvironment } from './env'

const productionEnvironment = {
  ...testEnvironment({}),
  NODE_ENV: 'production' as const,
  BETTER_AUTH_URL: 'https://app.reputationkey.app',
}

describe('environment parsing', () => {
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
        ...authority,
      }),
    ).not.toThrow()
    expect(() =>
      parseEnvironment({
        ...testEnvironment({}),
        RESTORE_MODE: 'isolated',
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
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: '',
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_SHA256: 'a'.repeat(64),
        REVIEW_LIFECYCLE_RECOVERY_APPROVAL_PUBLIC_KEYS_JSON: '',
      }),
    ).toThrow(/REVIEW_LIFECYCLE_RECOVERY_APPROVAL_BUNDLE_JSON: Too small/)
  })
})

describe('Portal address keyring', () => {
  const KEY = (digit: string) => digit.repeat(64)

  it('is optional: boot works without it and the address is shown once', () => {
    expect(
      parseEnvironment({ ...testEnvironment({}) }).PORTAL_ADDRESS_ENCRYPTION_KEYS,
    ).toBe(undefined)
  })

  it('accepts one entry, or an active key followed by retained ones', () => {
    for (const keys of [
      `1:${KEY('a')}`,
      `3:${KEY('a')},2:${KEY('b')},1:${KEY('c')}`,
      `9999:${KEY('d')}`,
    ]) {
      expect(
        parseEnvironment({ ...testEnvironment({}), PORTAL_ADDRESS_ENCRYPTION_KEYS: keys })
          .PORTAL_ADDRESS_ENCRYPTION_KEYS,
      ).toBe(keys)
    }
  })

  it.each([
    ['an empty value', ''],
    ['a bare key', KEY('a')],
    ['a label that is not a number', `v1:${KEY('a')}`],
    ['version zero', `0:${KEY('a')}`],
    ['a short key', `1:${'a'.repeat(63)}`],
    ['upper-case hex', `1:${'A'.repeat(64)}`],
    ['a repeated version', `1:${KEY('a')},1:${KEY('b')}`],
    ['five entries', [1, 2, 3, 4, 5].map((n) => `${n}:${KEY('a')}`).join(',')],
    ['a trailing comma', `1:${KEY('a')},`],
  ])('refuses %s at boot, naming the field and never the value', (_label, keys) => {
    let message = ''
    try {
      parseEnvironment({ ...testEnvironment({}), PORTAL_ADDRESS_ENCRYPTION_KEYS: keys })
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('PORTAL_ADDRESS_ENCRYPTION_KEYS')
    expect(message).not.toContain(KEY('a'))
  })
})

describe('production auth transport policy', () => {
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
      expect(() =>
        parseEnvironment({ ...productionEnvironment, BETTER_AUTH_URL: origin }),
      ).toThrow('Production BETTER_AUTH_URL must use HTTPS')
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
      expect(
        parseEnvironment({ ...productionEnvironment, BETTER_AUTH_URL: origin })
          .BETTER_AUTH_URL,
      ).toBe(origin)
    }
  })

  it('still prefers HTTPS, and accepts it anywhere', () => {
    expect(
      parseEnvironment({
        ...productionEnvironment,
        BETTER_AUTH_URL: 'https://app.reputationkey.app',
      }).BETTER_AUTH_URL,
    ).toBe('https://app.reputationkey.app')
  })
})

describe('REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED', () => {
  const parse = (value?: string) =>
    parseEnvironment({
      ...testEnvironment({}),
      ...(value === undefined
        ? {}
        : { REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED: value }),
    }).REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED

  it('is on when unset, so the sweep skips a Property reconciled inside six hours', () => {
    expect(parse()).toBe(true)
  })

  it('is on for true and off for false', () => {
    expect(parse('true')).toBe(true)
    expect(parse('false')).toBe(false)
  })

  it.each(['False', 'FALSE', '0', 'off', 'no', 'fasle', ' false', ''])(
    'refuses the near-miss %j at boot instead of silently leaving the switch on',
    (value) => {
      expect(() => parse(value)).toThrow('REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED')
    },
  )
})

describe('REVIEW_HEAD_CHECKS', () => {
  const parse = (value?: string) =>
    parseEnvironment({
      ...testEnvironment({}),
      ...(value === undefined ? {} : { REVIEW_HEAD_CHECKS: value }),
    }).REVIEW_HEAD_CHECKS

  it('is dark when unset, so a skipped discovery look is followed by a read-only head check', () => {
    expect(parse()).toBe('dark')
  })

  it('accepts exactly off and dark', () => {
    expect(parse('off')).toBe('off')
    expect(parse('dark')).toBe('dark')
  })

  it.each([
    'Dark',
    'DARK',
    'OFF',
    'Off',
    'on',
    'true',
    'false',
    '0',
    '1',
    'dak',
    ' off',
    '',
  ])(
    'refuses the near-miss %j at boot instead of silently leaving head checks on',
    (value) => {
      expect(() => parse(value)).toThrow('REVIEW_HEAD_CHECKS')
    },
  )

  it('refuses persist: storing from a head check is a later change', () => {
    expect(() => parse('persist')).toThrow('REVIEW_HEAD_CHECKS')
  })
})
