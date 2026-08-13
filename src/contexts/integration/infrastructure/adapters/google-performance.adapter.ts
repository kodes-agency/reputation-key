import {
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  type GooglePerformanceSourcePort,
} from '../../application/google-provider-contract'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import type { GoogleProviderCallAuthorization } from '../../application/google-provider-contract'
import { createGbpApiError } from '../../domain/gbp-api-error'
import { executeGoogleProviderRaw } from './google-provider-adapter'
import { parseGooglePerformanceResponse } from './google-performance-parser'
import { validateGoogleProviderSuffix } from './google-resource-suffix'

type FetchPerformanceInput = Parameters<GooglePerformanceSourcePort['fetchReport']>[0]

export function createGooglePerformanceAdapter(
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    nowMs?: () => number
  }>,
): Readonly<{
  fetchReport(
    input: FetchPerformanceInput,
    accessToken: string,
    authorization: GoogleProviderCallAuthorization,
  ): ReturnType<GooglePerformanceSourcePort['fetchReport']>
}> {
  const nowMs = deps.nowMs ?? Date.now

  return Object.freeze({
    fetchReport: async (input, accessToken, authorization) => {
      if (!validateGoogleProviderSuffix(input.locationId)) {
        throw createGbpApiError('fetchPerformanceReport', 'parse_error')
      }
      const response = await executeGoogleProviderRaw({
        operation: 'fetchPerformanceReport',
        descriptor: Object.freeze({
          routeKey: 'performance.fetch',
          accessToken,
          locationId: input.locationId,
          startLocalDate: input.startLocalDate,
          endLocalDate: input.endLocalDate,
        }),
        authorization,
        executor: deps.executor,
        nowMs,
        ...(input.signal ? { signal: input.signal } : {}),
      })
      return parseGooglePerformanceResponse({
        body: response.body,
        requestedMetrics: GOOGLE_PERFORMANCE_DAILY_METRICS,
        startLocalDate: input.startLocalDate,
        endLocalDate: input.endLocalDate,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    },
  })
}
