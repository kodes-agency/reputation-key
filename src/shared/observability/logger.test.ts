import { describe, expect, it } from 'vitest'
import { DatabaseError } from 'pg'
import {
  FAILED_WRITE_CONSTRAINT,
  failedFeedbackWrite,
} from '#/shared/db/testing/database-failure-fixtures'
import {
  isPrettyTransportAvailable,
  getLogger,
  normalizeTelemetryPath,
  sanitizeTelemetryValue,
} from './logger'

describe('development log transport', () => {
  it('resolves pino-pretty from an ESM module', () => {
    expect(isPrettyTransportAvailable()).toBe(true)
  })

  it('degrades to structured output when the optional transport is absent', () => {
    expect(
      isPrettyTransportAvailable(() => {
        throw new Error('module unavailable')
      }),
    ).toBe(false)
  })
})

describe('final structured log safety', () => {
  const lines: string[] = []
  const logger = getLogger({ write: (line: string) => lines.push(line) })

  it.each([
    'error',
    'err',
    'message',
    'errorMessage',
    'error_message',
    'failureReason',
    'failure_reason',
  ])('redacts a database failure flattened into %s, including nested fields', (field) => {
    const marker = 'private bound customer value'
    const failure = failedFeedbackWrite(marker)
    logger.error(
      { [field]: failure.message, nested: [{ [field]: failure.message }] },
      'Database write failed',
    )

    const line = lines.at(-1)!
    expect(line).not.toContain(marker)
    expect(JSON.parse(line)).toMatchObject({
      [field]: '[Redacted]',
      nested: [{ [field]: '[Redacted]' }],
      msg: 'Database write failed',
    })
  })

  it('redacts the dispatcher failure reason while retaining error facts and correlation', () => {
    const marker = 'private customer input'
    const err = Object.assign(
      new DatabaseError(`invalid input syntax for type uuid: "${marker}"`, 120, 'error'),
      { severity: 'ERROR', code: '22P02' },
    )
    logger.error(
      {
        err,
        correlationId: 'correlation-1',
        consumerName: 'inbox.project-review',
        failureReason: `${err.name}: ${err.message.split('\n')[0] ?? ''}`.slice(0, 200),
      },
      'Consumer handler failed — job will fail after remaining consumers run',
    )

    const line = lines.at(-1)!
    expect(line).not.toContain(marker)
    expect(JSON.parse(line)).toMatchObject({
      err: { name: 'error', code: '22P02', db_code: '22P02' },
      correlationId: 'correlation-1',
      consumerName: 'inbox.project-review',
      failureReason: '[Redacted]',
      msg: 'Consumer handler failed — job will fail after remaining consumers run',
    })
  })

  it('allowlists a plain error record while retaining safe status and code', () => {
    const marker = 'private bound customer value'
    logger.error(
      {
        error: {
          name: 'DatabaseError',
          code: 'write_failed',
          status: 500,
          message: marker,
          detail: marker,
          params: [marker],
          cause: { detail: marker },
        },
      },
      'Database write failed',
    )

    const line = lines.at(-1)!
    expect(line).not.toContain(marker)
    expect(JSON.parse(line).error).toEqual({
      name: 'DatabaseError',
      code: 'write_failed',
      status: 500,
    })
  })

  it('preserves the safe Error-object serializer in the final log line', () => {
    const marker = 'private bound customer value'
    logger.error({ error: failedFeedbackWrite(marker) }, 'Database write failed')

    const line = lines.at(-1)!
    expect(line).not.toContain(marker)
    expect(JSON.parse(line).error).toEqual({
      name: 'DrizzleQueryError',
      cause_code: '23505',
      db_code: '23505',
      db_constraint: FAILED_WRITE_CONSTRAINT,
      db_table: 'feedback',
    })
  })
})

describe('Google credential telemetry safety', () => {
  it('redacts sensitive fields recursively without removing safe codes', () => {
    const marker = 'marker-secret-value'
    const result = sanitizeTelemetryValue({
      authorizationCode: marker,
      correlationId: 'correlation-1',
      outcomeCode: 'deadline_exceeded',
      nested: [
        {
          access_token: marker,
          refreshToken: marker,
          idToken: marker,
          codeVerifier: marker,
          oauthStateHandleDigest: marker,
          providerUrl: `https://google.example/locations/${marker}`,
          responseBody: marker,
          headers: {
            Authorization: `Bearer ${marker}`,
            Cookie: `session=${marker}`,
          },
        },
      ],
    })

    expect(JSON.stringify(result)).not.toContain(marker)
    expect(result).toMatchObject({
      authorizationCode: '[Redacted]',
      correlationId: 'correlation-1',
      outcomeCode: 'deadline_exceeded',
    })
  })

  it('redacts common credential and personal-data spellings from structured logs', () => {
    const marker = 'marker-private-value'
    const result = sanitizeTelemetryValue({
      password: marker,
      password_hash: marker,
      clientSecret: marker,
      OPENAI_API_KEY: marker,
      contactEmail: marker,
      reviewerName: marker,
      reviewText: marker,
      DATABASE_URL: `postgresql://user:${marker}@database/repkey`,
      outcomeCode: 'provider_rejected',
    })

    expect(JSON.stringify(result)).not.toContain(marker)
    expect(result).toMatchObject({ outcomeCode: 'provider_rejected' })
  })

  it('serializes errors without retaining message, stack, or secret fields', () => {
    const error = Object.assign(new Error('refresh token marker-secret-value'), {
      code: 'oauth_failed',
      accessToken: 'marker-secret-value',
    })

    expect(sanitizeTelemetryValue(error)).toEqual({
      name: 'Error',
      code: 'oauth_failed',
    })
  })

  it('reduces a database failure to its class and database facts wherever it is logged', () => {
    const marker = 'private customer text'

    expect(
      sanitizeTelemetryValue({
        outcomeCode: 'write_failed',
        err: failedFeedbackWrite(marker),
      }),
    ).toEqual({
      outcomeCode: 'write_failed',
      err: {
        name: 'DrizzleQueryError',
        cause_code: '23505',
        db_code: '23505',
        db_constraint: FAILED_WRITE_CONSTRAINT,
        db_table: 'feedback',
      },
    })
  })

  it('redacts a flattened error stack and the values a query was bound to', () => {
    const marker = 'private customer text'
    const result = sanitizeTelemetryValue({
      outcomeCode: 'write_failed',
      nested: { stack: `Error: ${marker}\n    at insert (db.ts:1:1)`, params: [marker] },
    })

    expect(JSON.stringify(result)).not.toContain(marker)
    expect(result).toMatchObject({ outcomeCode: 'write_failed' })
  })

  it('keeps the fields that read as plain language: an alert detail and a cause code', () => {
    expect(
      sanitizeTelemetryValue({
        detail: 'oldest unpublished outbox event is 61000ms old',
        context: { cause: 'provider_truth' },
      }),
    ).toEqual({
      detail: 'oldest unpublished outbox event is 61000ms old',
      context: { cause: 'provider_truth' },
    })
  })

  it('normalizes callback and request URLs to a path before observation', () => {
    expect(
      normalizeTelemetryPath(
        'https://app.example.test/api/auth/google/callback?code=secret&state=secret',
      ),
    ).toBe('/api/auth/google/callback')
    expect(
      normalizeTelemetryPath('/properties/import-google?providerError=secret#fragment'),
    ).toBe('/properties/import-google')
  })
})
