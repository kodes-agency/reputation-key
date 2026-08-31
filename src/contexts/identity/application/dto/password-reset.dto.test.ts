import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  requestPasswordResetFormSchema,
  setNewPasswordFormSchema,
} from './password-reset.dto'

/** The field path a form error must land on for the input to show it. */
const issuePaths = (error: unknown): ReadonlyArray<string> =>
  error instanceof ZodError
    ? error.issues.map((issue) => issue.path.join('.'))
    : ['<not a ZodError>']

const issueMessages = (error: unknown): ReadonlyArray<string> =>
  error instanceof ZodError ? error.issues.map((issue) => issue.message) : []

describe('requestPasswordResetFormSchema', () => {
  it('accepts a well-formed email address', () => {
    expect(
      requestPasswordResetFormSchema.parse({ email: 'ops@meridian.example' }),
    ).toEqual({ email: 'ops@meridian.example' })
  })

  it.each(['', 'ops', 'ops@', 'ops@example', '@meridian.example'])(
    'rejects %o on the email field rather than accepting an unreachable address',
    (email) => {
      const result = requestPasswordResetFormSchema.safeParse({ email })

      expect(result.success).toBe(false)
      expect(issuePaths(result.error)).toEqual(['email'])
      expect(issueMessages(result.error)).toEqual(['A valid email address is required'])
    },
  )
})

describe('setNewPasswordFormSchema', () => {
  it('accepts a confirmed password at the minimum length', () => {
    const input = { newPassword: 'a'.repeat(8), confirmPassword: 'a'.repeat(8) }

    expect(setNewPasswordFormSchema.parse(input)).toEqual(input)
  })

  /**
   * Eight characters is the floor the reset form advertises. A seven-character
   * password must fail here, not at better-auth, or the user is told the reset
   * failed without being told why.
   */
  it('rejects a password one character below the advertised minimum', () => {
    const short = 'a'.repeat(7)
    const result = setNewPasswordFormSchema.safeParse({
      newPassword: short,
      confirmPassword: short,
    })

    expect(result.success).toBe(false)
    expect(issuePaths(result.error)).toEqual(['newPassword'])
    expect(issueMessages(result.error)).toEqual([
      'Password must be at least 8 characters',
    ])
  })

  /**
   * The mismatch issue must be reported on `confirmPassword`: the form binds
   * errors by field path, so an issue raised at the object root would leave the
   * user staring at a form with no visible problem.
   */
  it('reports a confirmation mismatch on the confirmation field', () => {
    const result = setNewPasswordFormSchema.safeParse({
      newPassword: 'correct-horse',
      confirmPassword: 'correct-hors',
    })

    expect(result.success).toBe(false)
    expect(issuePaths(result.error)).toEqual(['confirmPassword'])
    expect(issueMessages(result.error)).toEqual(['Passwords do not match'])
  })

  /**
   * The refinement still runs after the field-level failure, so an empty
   * confirmation raises both issues. Both must stay on `confirmPassword`: the
   * field is the only place the form can render either one.
   */
  it('rejects an empty confirmation and keeps every issue on that field', () => {
    const result = setNewPasswordFormSchema.safeParse({
      newPassword: 'correct-horse',
      confirmPassword: '',
    })

    expect(result.success).toBe(false)
    expect(issuePaths(result.error)).toEqual(['confirmPassword', 'confirmPassword'])
    expect(issueMessages(result.error)).toEqual([
      'Please confirm your password',
      'Passwords do not match',
    ])
  })

  it('throws a ZodError from parse when the passwords disagree', () => {
    expect(() =>
      setNewPasswordFormSchema.parse({
        newPassword: 'correct-horse',
        confirmPassword: 'battery-staple',
      }),
    ).toThrow(ZodError)
  })
})
