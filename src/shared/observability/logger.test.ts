import { describe, expect, it } from 'vitest'
import { normalizeTelemetryPath, sanitizeTelemetryValue } from './logger'

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

  it('normalizes callback and request URLs to a path before observation', () => {
    expect(
      normalizeTelemetryPath(
        'https://app.example.test/api/auth/google/callback?code=secret&state=secret',
      ),
    ).toBe('/api/auth/google/callback')
    expect(normalizeTelemetryPath('/import?providerError=secret#fragment')).toBe(
      '/import',
    )
  })
})
