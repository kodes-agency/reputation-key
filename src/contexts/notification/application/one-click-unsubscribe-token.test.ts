import { describe, expect, it } from 'vitest'
import {
  activeOneClickUnsubscribeKeyVersion,
  createOneClickUnsubscribeToken,
  ONE_CLICK_UNSUBSCRIBE_PATH,
  oneClickUnsubscribeUrl,
  verifyOneClickUnsubscribeToken,
} from './one-click-unsubscribe-token'

const KEYS = `v2:${'22'.repeat(32)},v1:${'11'.repeat(32)}`
const OLD_KEYS = `v1:${'11'.repeat(32)}`
const EMAIL_ID = '81000000-0000-4000-8000-000000000011'
const BATCH_ID = '82000000-0000-4000-8000-000000000022'

describe('one-click unsubscribe capability token', () => {
  it('round-trips email and immutable digest-batch targets', () => {
    for (const target of [
      { kind: 'email', id: EMAIL_ID },
      { kind: 'digest', id: BATCH_ID },
    ] as const) {
      const token = createOneClickUnsubscribeToken(KEYS, target)
      expect(verifyOneClickUnsubscribeToken(KEYS, token)).toEqual(target)
    }
  })

  it('keeps links valid across one active-plus-retained key rotation', () => {
    const oldToken = createOneClickUnsubscribeToken(OLD_KEYS, {
      kind: 'email',
      id: EMAIL_ID,
    })

    expect(verifyOneClickUnsubscribeToken(KEYS, oldToken)).toEqual({
      kind: 'email',
      id: EMAIL_ID,
    })
  })

  it('can reproduce a token with a persisted retained key version', () => {
    const target = { kind: 'digest', id: BATCH_ID } as const
    const beforeRotation = createOneClickUnsubscribeToken(OLD_KEYS, target)
    const onRetry = createOneClickUnsubscribeToken(KEYS, target, 'v1')

    expect(onRetry).toBe(beforeRotation)
    expect(onRetry).toMatch(/^v1\./u)
    expect(activeOneClickUnsubscribeKeyVersion(KEYS)).toBe('v2')
  })

  it('fails closed when a persisted signing version is no longer retained', () => {
    expect(() =>
      createOneClickUnsubscribeToken(KEYS, { kind: 'digest', id: BATCH_ID }, 'v0'),
    ).toThrow('Unsubscribe HMAC key version is unavailable: v0')
  })

  it.each([
    '',
    'malformed',
    createOneClickUnsubscribeToken(KEYS, { kind: 'email', id: EMAIL_ID }).replace(
      /.$/u,
      'x',
    ),
  ])('rejects malformed or tampered token %j without throwing', (token) => {
    expect(verifyOneClickUnsubscribeToken(KEYS, token)).toBeNull()
  })

  it('builds the unauthenticated endpoint URL without replacing the preferences URL', () => {
    const url = oneClickUnsubscribeUrl('https://app.example.com/', KEYS, {
      kind: 'digest',
      id: BATCH_ID,
    })

    expect(new URL(url).pathname).toBe(ONE_CLICK_UNSUBSCRIBE_PATH)
    expect(
      verifyOneClickUnsubscribeToken(KEYS, new URL(url).searchParams.get('token')!),
    ).toEqual({ kind: 'digest', id: BATCH_ID })
  })
})
