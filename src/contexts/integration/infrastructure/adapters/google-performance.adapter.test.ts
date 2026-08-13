import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { isGbpApiError } from '../../domain/gbp-api-error'
import { createGooglePerformanceAdapter } from './google-performance.adapter'

const input = Object.freeze({
  organizationId: organizationId('organization-1'),
  propertyId: propertyId('property-1'),
  connectionId: googleConnectionId('connection-1'),
  expectedConnectionLifecycleVersion: 3,
  expectedConnectionAccessVersion: 4,
  expectedCredentialGeneration: 5,
  expectedSourceEpoch: 6,
  locationId: 'location-1',
  startLocalDate: '2026-07-01',
  endLocalDate: '2026-07-31',
})
const authorization = Object.freeze({
  capability: 'property.read_gbp_performance' as const,
  organizationId: input.organizationId,
  propertyId: input.propertyId,
  connectionId: input.connectionId,
  initiatorUserId: 'user-1',
  approvalBindingId: 'approval-1',
  authorizationVector: Object.freeze({ policyVersion: 1 }),
})

function responseBody() {
  return new TextEncoder().encode(
    JSON.stringify({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'WEBSITE_CLICKS',
              timeSeries: {
                datedValues: [{ date: { year: 2026, month: 7, day: 1 }, value: '2' }],
              },
            },
          ],
        },
      ],
    }),
  )
}

describe('Google Performance adapter', () => {
  it('authorizes the frozen identity vector and executes the exact bounded route', async () => {
    const body = responseBody()
    const execute: GoogleAuthorizedProviderExecutor['execute'] = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      headers: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'private',
        retryAfter: null,
      },
      body,
    }))
    const authorize = vi.fn(async () => authorization)
    const adapter = createGooglePerformanceAdapter({
      executor: { execute },
      nowMs: () => 1_000,
    })

    await expect(
      adapter.fetchReport(input, 'access-token', await authorize()),
    ).resolves.toEqual({
      requestedRange: {
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      },
      series: [
        {
          metric: 'WEBSITE_CLICKS',
          points: [{ localDate: '2026-07-01', value: 2 }],
        },
      ],
    })
    expect(authorize).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(
      {
        routeKey: 'performance.fetch',
        accessToken: 'access-token',
        locationId: 'location-1',
        startLocalDate: '2026-07-01',
        endLocalDate: '2026-07-31',
      },
      { authorization, deadlineMs: 16_000 },
    )
    expect(body.every((byte) => byte === 0)).toBe(true)
  })

  it('classifies throttling without retaining the provider body', async () => {
    const body = new TextEncoder().encode('{"provider":"detail"}')
    const adapter = createGooglePerformanceAdapter({
      executor: {
        execute: async () => ({
          ok: true,
          status: 429,
          headers: {
            contentType: 'application/json',
            cacheControl: 'no-store',
            retryAfter: '11',
          },
          body,
        }),
      },
      nowMs: () => 0,
    })

    await expect(
      adapter.fetchReport(input, 'access-token', authorization),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isGbpApiError(error) &&
        error.kind === 'rate_limited' &&
        error.retryAfterMs === 11_000 &&
        error.providerBodyBytes === 21,
    )
    expect(body.every((byte) => byte === 0)).toBe(true)
  })
})
