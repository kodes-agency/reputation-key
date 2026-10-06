import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { isEmailNotVerified } from './email-not-verified'

describe('isEmailNotVerified', () => {
  it('recognises the refusal a sign-in gives an unverified address', () => {
    const error = new ServerFunctionError(
      'AuthError',
      'Verify your email before signing in.',
      'email_not_verified',
      403,
    )

    expect(isEmailNotVerified(error)).toBe(true)
  })

  it('leaves a wrong password to the ordinary error banner', () => {
    const error = new ServerFunctionError(
      'AuthError',
      'Invalid email or password',
      'invalid_credentials',
      401,
    )

    expect(isEmailNotVerified(error)).toBe(false)
  })

  it.each([
    [null],
    [undefined],
    [new Error('email_not_verified')],
    ['email_not_verified'],
  ])('ignores %j, which carries no server code', (error) => {
    expect(isEmailNotVerified(error)).toBe(false)
  })
})
