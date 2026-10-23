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

describe('PORTAL_PRINT_ORIGIN', () => {
  const parse = (value?: string, base: Record<string, unknown> = {}) =>
    parseEnvironment({
      ...testEnvironment({}),
      ...base,
      ...(value === undefined ? {} : { PORTAL_PRINT_ORIGIN: value }),
    }).PORTAL_PRINT_ORIGIN

  it('is optional: nothing changes at boot where it is unset', () => {
    expect(parse()).toBeUndefined()
  })

  it('accepts the beta print host, with or without its trailing slash', () => {
    expect(parse('https://ap.up.railway.app', productionEnvironment)).toBe(
      'https://ap.up.railway.app',
    )
    expect(parse('https://ap.up.railway.app/', productionEnvironment)).toBe(
      'https://ap.up.railway.app/',
    )
  })

  it('accepts a host of 25 characters and refuses 26, naming the field', () => {
    expect(parse(`https://${'a'.repeat(25)}`, productionEnvironment)).toBeDefined()
    expect(() => parse(`https://${'a'.repeat(26)}`, productionEnvironment)).toThrow(
      /PORTAL_PRINT_ORIGIN: .*at most 25 characters/,
    )
  })

  it.each([
    ['a path', 'https://ap.up.railway.app/p'],
    ['a query', 'https://ap.up.railway.app?x=1'],
    ['credentials', 'https://user:pass@ap.up.railway.app'],
    ['text that is not a URL', 'ap.up.railway.app'],
    ['an empty value', ''],
  ])('refuses %s at boot, naming the field', (_label, value) => {
    expect(() => parse(value, productionEnvironment)).toThrow('PORTAL_PRINT_ORIGIN')
  })

  it('refuses a plaintext print origin in production, as for the auth origin', () => {
    expect(() => parse('http://ap.up.railway.app', productionEnvironment)).toThrow(
      'Production PORTAL_PRINT_ORIGIN must use HTTPS',
    )
  })

  it('allows plaintext outside production and on loopback, where nothing crosses a network', () => {
    expect(parse('http://ap.localhost:3000')).toBe('http://ap.localhost:3000')
    expect(parse('http://127.0.0.1:3001', productionEnvironment)).toBe(
      'http://127.0.0.1:3001',
    )
  })

  it('does not fail on the transport rule when the value is not a URL at all', () => {
    // The shape message is the one to show; the transport check must not throw a
    // TypeError of its own on a value the shape check already refused.
    expect(() => parse('not a url', productionEnvironment)).toThrow(/PORTAL_PRINT_ORIGIN/)
  })

  it('accepts an origin equal to the app origin: the redirect turns itself off', () => {
    expect(parse('https://app.reputationkey.app', productionEnvironment)).toBe(
      'https://app.reputationkey.app',
    )
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

  it('accepts exactly off, dark and persist', () => {
    expect(parse('off')).toBe('off')
    expect(parse('dark')).toBe('dark')
    expect(parse('persist')).toBe('persist')
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

  it.each(['Persist', 'PERSIST', 'persit', 'store', ' persist'])(
    'refuses the near-miss %j for persist at boot instead of falling back to a mode',
    (value) => {
      expect(() => parse(value)).toThrow('REVIEW_HEAD_CHECKS')
    },
  )
})

describe('REVIEW_RECONCILE_WITHIN_HOURS', () => {
  const parse = (value?: string) =>
    parseEnvironment({
      ...testEnvironment({}),
      ...(value === undefined ? {} : { REVIEW_RECONCILE_WITHIN_HOURS: value }),
    }).REVIEW_RECONCILE_WITHIN_HOURS

  it('is six hours when unset, the window the skip rule shipped with', () => {
    expect(parse()).toBe(6)
  })

  it('accepts a whole number of hours from six to twenty-four', () => {
    expect(parse('6')).toBe(6)
    expect(parse('12')).toBe(12)
    expect(parse('24')).toBe(24)
  })

  it.each(['5', '0', '-6', '25', '48', '6.5', 'six', ''])(
    'refuses %j at boot: below six the sweep guarantee breaks, above twenty-four a Property goes a day unlisted',
    (value) => {
      expect(() => parse(value)).toThrow('REVIEW_RECONCILE_WITHIN_HOURS')
    },
  )
})

describe('GBP_PUBSUB_NOTIFICATION_TYPES', () => {
  it('subscribes to new and updated reviews when unset, so an edited review is caught too', () => {
    expect(
      parseEnvironment({ ...testEnvironment({}) }).GBP_PUBSUB_NOTIFICATION_TYPES,
    ).toBe('NEW_REVIEW,UPDATED_REVIEW')
  })

  it('keeps an operator-set value as written', () => {
    expect(
      parseEnvironment({
        ...testEnvironment({}),
        GBP_PUBSUB_NOTIFICATION_TYPES: 'NEW_REVIEW',
      }).GBP_PUBSUB_NOTIFICATION_TYPES,
    ).toBe('NEW_REVIEW')
  })
})
