import { describe, expect, it } from 'vitest'
import {
  FAILED_WRITE_CONSTRAINT,
  failedFeedbackWrite,
} from '#/shared/db/testing/database-failure-fixtures'
import {
  isPrettyTransportAvailable,
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
