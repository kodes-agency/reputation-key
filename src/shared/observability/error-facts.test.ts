import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { errorFactTags } from './error-facts'

/** The shape node-postgres gives a server-reported failure. */
function postgresError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    severity: 'ERROR',
    code: '23505',
    detail: 'Key (email)=(guest@example.invalid) already exists.',
    ...fields,
  })
}

describe('errorFactTags', () => {
  it('reads the code a server function error was thrown with', () => {
    const error = new ServerFunctionError(
      'FeedbackError',
      'Feedback could not be sent',
      'temporarily_unavailable',
      503,
    )

    expect(errorFactTags(error)).toEqual({ error_code: 'temporarily_unavailable' })
  })

  it('reads the code of the failure a wrapper was built around', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:6379'), {
      code: 'ECONNREFUSED',
    })
    const error = new ServerFunctionError(
      'InternalError',
      'Internal server error',
      'internal_error',
      500,
      { cause },
    )

    expect(errorFactTags(error)).toEqual({
      error_code: 'internal_error',
      cause_code: 'ECONNREFUSED',
    })
  })

  it('names the database refusal by its code and schema names, never its values', () => {
    const database = postgresError({
      constraint: 'users_email_key',
      table: 'users',
      column: 'email',
    })
    const query = Object.assign(
      new Error('Failed query: insert into "users"\nparams: guest@example.invalid'),
      { cause: database },
    )

    const tags = errorFactTags(query)

    expect(tags).toEqual({
      cause_code: '23505',
      db_code: '23505',
      db_constraint: 'users_email_key',
      db_table: 'users',
      db_column: 'email',
    })
    expect(JSON.stringify(tags)).not.toContain('guest@example.invalid')
  })

  it('drops a schema name that is not shaped like an identifier', () => {
    expect(
      errorFactTags(postgresError({ table: 'users"; drop', constraint: 'a b' })),
    ).toEqual({ error_code: '23505', db_code: '23505' })
  })

  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: https://a.invalid/x.js'],
    ['Firefox', 'error loading dynamically imported module: https://a.invalid/x.js'],
    ['Safari', 'Importing a module script failed.'],
    ['a stylesheet', 'Unable to preload CSS for /assets/x.css'],
  ])('classifies a code file %s could not load', (_label, message) => {
    expect(errorFactTags(new TypeError(message))).toEqual({ error_kind: 'chunk_load' })
  })

  it.each([
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
  ])('classifies the network failure "%s"', (message) => {
    expect(errorFactTags(new TypeError(message))).toEqual({ error_kind: 'network' })
  })

  it('gives no kind for a message it does not recognise', () => {
    expect(
      errorFactTags(new TypeError("Cannot read properties of undefined (reading 'x')")),
    ).toEqual({})
  })

  it.each([
    ['a code with spaces', 'not a code'],
    ['a code that is too long', `a${'b'.repeat(80)}`],
    ['a numeric code', 500],
  ])('ignores %s', (_label, code) => {
    expect(errorFactTags(Object.assign(new Error('x'), { code }))).toEqual({})
  })

  it('stops at a cause that points back at itself', () => {
    const error: Error & { cause?: unknown } = new Error('loop')
    error.cause = error

    expect(errorFactTags(error)).toEqual({})
  })

  it.each([undefined, null, 'a string', 42])('has nothing to say about %s', (value) => {
    expect(errorFactTags(value)).toEqual({})
  })
})
