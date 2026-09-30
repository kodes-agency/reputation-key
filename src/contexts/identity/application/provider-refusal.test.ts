import { APIError } from 'better-auth'
import { describe, expect, it } from 'vitest'
import { providerRefusalCode } from './provider-refusal'

describe('providerRefusalCode', () => {
  it('reads the reason code off a Better Auth refusal', () => {
    expect(
      providerRefusalCode(
        APIError.from('FORBIDDEN', {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Email not verified',
        }),
      ),
    ).toBe('EMAIL_NOT_VERIFIED')
  })

  it.each([
    ['a plain Error', new Error('EMAIL_NOT_VERIFIED')],
    [
      'an error named APIError without a body',
      Object.assign(new Error('x'), { name: 'APIError' }),
    ],
    [
      'an APIError-named error whose body code is not text',
      Object.assign(new Error('x'), { name: 'APIError', body: { code: 403 } }),
    ],
    ['a non-error value', { name: 'APIError', body: { code: 'EMAIL_NOT_VERIFIED' } }],
    ['undefined', undefined],
  ])('reads %s as no refusal code', (_name, value) => {
    expect(providerRefusalCode(value)).toBeNull()
  })
})
