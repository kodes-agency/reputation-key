import { describe, expect, it } from 'vitest'
import {
  FAILED_WRITE_CONSTRAINT,
  failedFeedbackWrite,
} from '#/shared/db/testing/database-failure-fixtures'
import { summarizeError } from './error-summary'

describe('summarizeError', () => {
  it('says what kind of failure a query was, from its class and the database refusal', () => {
    const privateText = 'a guest wrote their phone number here'

    const summary = summarizeError(failedFeedbackWrite(privateText))

    expect(summary).toEqual({
      name: 'DrizzleQueryError',
      cause_code: '23505',
      db_code: '23505',
      db_constraint: FAILED_WRITE_CONSTRAINT,
      db_table: 'feedback',
    })
    expect(JSON.stringify(summary)).not.toContain(privateText)
  })

  it('keeps the name and code of an error the application raised', () => {
    const error = Object.assign(new TypeError('refresh token marker-secret-value'), {
      code: 'oauth_failed',
      accessToken: 'marker-secret-value',
    })

    expect(summarizeError(error)).toEqual({ name: 'TypeError', code: 'oauth_failed' })
  })

  it('names a plain error Error and anything thrown that is not an error UnknownError', () => {
    expect(summarizeError(new Error('private text'))).toEqual({ name: 'Error' })
    expect(summarizeError('private text')).toEqual({ name: 'UnknownError' })
    expect(summarizeError(undefined)).toEqual({ name: 'UnknownError' })
  })

  it('drops a name, code or constraint that is not the shape of one, and survives a cause loop', () => {
    const error = Object.assign(new Error('private text'), {
      name: 'private text',
      code: 'private text',
      severity: 'ERROR',
      constraint: 'private text',
    })
    error.cause = error

    expect(summarizeError(error)).toEqual({ name: 'UnknownError' })
  })
})
