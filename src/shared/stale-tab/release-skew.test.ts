// A tab keeps the code of the release that served its page; the server keeps
// moving. These are the facts that decide, per call and before any handler
// runs, whether the two still agree, and what the server does about it.
import { describe, expect, it } from 'vitest'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import { httpStatus, isExpectedRefusal } from '#/shared/security/expected-refusal'
import {
  RELEASE_HEADER,
  STALE_CLIENT_CODE,
  answerSkew,
  concreteRelease,
  isStaleClientError,
} from './release-skew'
import { staleClientRefusal } from './stale-client-refusal'

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

describe('concreteRelease', () => {
  it('accepts a full commit hash', () => {
    expect(concreteRelease(OLD)).toBe(OLD)
  })

  it('accepts an abbreviated hash', () => {
    expect(concreteRelease('1636d230c')).toBe('1636d230c')
  })

  it.each([
    ['the server default when no release is configured', 'unknown'],
    ['an empty string', ''],
    ['text that is not a hash', 'local-dev'],
    ['upper case', 'A'.repeat(40)],
    ['a header-injection attempt', `${OLD}\r\nx-evil: 1`],
    ['too short to name a commit', 'abc12'],
    ['too long to be a hash', 'a'.repeat(65)],
  ])('refuses %s', (_label, value) => {
    expect(concreteRelease(value)).toBeUndefined()
  })

  it.each([undefined, null, 7, {}])('refuses %j', (value) => {
    expect(concreteRelease(value)).toBeUndefined()
  })
})

describe('answerSkew', () => {
  it('lets a call through when the tab and the server run the same release', () => {
    expect(answerSkew({ tabRelease: OLD, serverRelease: OLD, method: 'GET' })).toBe(
      'proceed',
    )
    expect(answerSkew({ tabRelease: OLD, serverRelease: OLD, method: 'POST' })).toBe(
      'proceed',
    )
  })

  it('refuses a read from a tab whose code is older than the server', () => {
    expect(answerSkew({ tabRelease: OLD, serverRelease: NEW, method: 'GET' })).toBe(
      'refuse',
    )
  })

  it('finishes a mutation from such a tab and flags it, so nothing is lost', () => {
    expect(answerSkew({ tabRelease: OLD, serverRelease: NEW, method: 'POST' })).toBe(
      'flag',
    )
  })

  it.each([undefined, null, '', 'unknown', 'not a hash'])(
    'does nothing when the tab sent %j (a client from before this check, or no browser)',
    (tabRelease) => {
      expect(answerSkew({ tabRelease, serverRelease: NEW, method: 'GET' })).toBe(
        'proceed',
      )
    },
  )

  it.each([undefined, 'unknown', ''])(
    'does nothing when the server cannot name its own release (%j)',
    (serverRelease) => {
      expect(answerSkew({ tabRelease: OLD, serverRelease, method: 'GET' })).toBe(
        'proceed',
      )
      expect(answerSkew({ tabRelease: OLD, serverRelease, method: 'POST' })).toBe(
        'proceed',
      )
    },
  )
})

describe('the refusal', () => {
  it('is a typed 409 the existing error plumbing already understands', () => {
    const refusal = staleClientRefusal()

    expect(isServerFunctionError(refusal)).toBe(true)
    expect(refusal.code).toBe(STALE_CLIENT_CODE)
    expect(refusal.status).toBe(409)
  })

  it('is an expected refusal, so monitoring does not page anyone for it', () => {
    expect(httpStatus(staleClientRefusal())).toBe(409)
    expect(isExpectedRefusal(staleClientRefusal())).toBe(true)
  })

  it('says what to do, in words a person can read', () => {
    expect(staleClientRefusal().message).toMatch(/reload/i)
  })

  it('is recognised by shape, as it arrives rebuilt from the wire', () => {
    const rebuilt = Object.assign(new Error('x'), {
      _tag: 'StaleClient',
      code: STALE_CLIENT_CODE,
      status: 409,
    })

    expect(isStaleClientError(rebuilt)).toBe(true)
  })

  it.each([
    [
      'another server-function error',
      Object.assign(new Error('x'), { _tag: 'T', code: 'not_found', status: 404 }),
    ],
    ['a plain error', new Error('stale_client')],
    [
      'the same code on a different status',
      Object.assign(new Error('x'), { code: STALE_CLIENT_CODE, status: 500 }),
    ],
    ['a string', STALE_CLIENT_CODE],
    ['nothing', undefined],
  ])('is not confused with %s', (_label, value) => {
    expect(isStaleClientError(value)).toBe(false)
  })
})

describe('the header', () => {
  it('has one lower-case name both ends agree on', () => {
    expect(RELEASE_HEADER).toBe('x-repkey-release')
  })
})
