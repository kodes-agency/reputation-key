import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from '#/contexts/integration/server/google-performance'
import {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  type PropertyGooglePerformanceResultV1,
  type PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import { dashboardKeys } from '#/shared/queries/query-keys'
import {
  useClearPerformanceOnLifecycle,
  usePerformanceExpiry,
  useRetryCountdown,
  type PerformanceClearReason,
} from './use-google-performance-lifecycle'
import { usePageVisibleAndFocused } from '#/components/hooks/use-page-visible-and-focused'
import { useHydrated } from '#/components/hooks/use-hydrated'
import {
  PerformanceQueryError,
  toPerformanceErrorResult,
} from './google-performance-query'

export type GooglePerformanceServerFns = Readonly<{
  getPerformance: typeof getPropertyGooglePerformance
  renewLease: typeof renewPropertyGooglePerformanceLease
}>

export function useGooglePerformance(
  input: Readonly<{
    propertyId: string
    preset: PropertyPerformancePreset
    serverFns: GooglePerformanceServerFns
  }>,
) {
  const getPerformance = useServerFn(input.serverFns.getPerformance)
  const renewLease = useServerFn(input.serverFns.renewLease)
  const queryClient = useQueryClient()
  const pageActive = usePageVisibleAndFocused()
  const hydrated = useHydrated()
  const [viewEpoch, setViewEpoch] = useState(0)
  const [reportEnabled, setReportEnabled] = useState(true)
  const [clearReason, setClearReason] = useState<PerformanceClearReason | null>(null)
  const queryKey = useMemo(
    () =>
      dashboardKeys.googlePerformance(
        input.propertyId,
        input.preset,
        GOOGLE_PERFORMANCE_CATALOG_VERSION,
        viewEpoch,
      ),
    [input.preset, input.propertyId, viewEpoch],
  )

  const clearQueryKey = useCallback(
    async (key: QueryKey) => {
      await queryClient.cancelQueries({ queryKey: key, exact: false })
      queryClient.removeQueries({ queryKey: key, exact: false })
    },
    [queryClient],
  )

  const clearVolatileContent = useCallback(
    (reason: PerformanceClearReason) => {
      const expiredKey = queryKey
      setClearReason(reason)
      setReportEnabled(false)
      setViewEpoch((current) => current + 1)
      void clearQueryKey(expiredKey)
    },
    [clearQueryKey, queryKey],
  )

  useClearPerformanceOnLifecycle(hydrated, clearVolatileContent)

  useEffect(
    () => () => {
      void clearQueryKey(queryKey)
    },
    [clearQueryKey, queryKey],
  )

  const query = useQuery<PropertyGooglePerformanceResultV1, Error>({
    queryKey,
    queryFn: async ({ signal }): Promise<PropertyGooglePerformanceResultV1> => {
      const result = await getPerformance({
        data: { propertyId: input.propertyId, preset: input.preset },
        signal,
      })
      if (result.status === 'error') throw new PerformanceQueryError(result)
      return result
    },
    enabled: hydrated && reportEnabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googlePerformanceViewEpoch: viewEpoch },
  })

  const report = query.data?.status === 'ready' ? query.data.data : null
  const lease = report?.authorizationLease ?? null

  usePerformanceExpiry(
    report?.contentExpiresAt ?? null,
    lease?.expiresAt ?? null,
    clearReason,
    clearVolatileContent,
  )

  const leaseQuery = useQuery({
    queryKey: dashboardKeys.googlePerformanceLease(
      input.propertyId,
      input.preset,
      GOOGLE_PERFORMANCE_CATALOG_VERSION,
      viewEpoch,
      lease?.leaseRef ?? 'none',
    ),
    queryFn: ({ signal }) =>
      renewLease({
        data: {
          propertyId: input.propertyId,
          leaseRef: lease!.leaseRef,
        },
        signal,
      }),
    enabled:
      hydrated &&
      reportEnabled &&
      clearReason === null &&
      pageActive &&
      lease !== null &&
      report !== null,
    initialData: lease ? { ok: true as const, lease } : undefined,
    initialDataUpdatedAt: report ? new Date(report.retrievedAt).getTime() : undefined,
    staleTime: lease?.renewAfterMs ?? 10_000,
    refetchInterval: lease?.renewAfterMs ?? 10_000,
    refetchIntervalInBackground: false,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { googlePerformanceViewEpoch: viewEpoch },
  })

  useEffect(() => {
    if (
      !report ||
      !reportEnabled ||
      clearReason !== null ||
      (!leaseQuery.isError && leaseQuery.data?.ok !== false)
    ) {
      return
    }
    const timeout = window.setTimeout(() => clearVolatileContent('authorization_lost'), 0)
    return () => window.clearTimeout(timeout)
  }, [
    clearReason,
    clearVolatileContent,
    leaseQuery.data,
    leaseQuery.isError,
    report,
    reportEnabled,
  ])

  useEffect(() => {
    if (!report || !reportEnabled || clearReason !== null || !leaseQuery.data?.ok) {
      return
    }
    const renewedLease = leaseQuery.data.lease
    if (renewedLease === report.authorizationLease) return
    const renewedResult: PropertyGooglePerformanceResultV1 = {
      status: 'ready',
      data: Object.freeze({ ...report, authorizationLease: renewedLease }),
    }
    queryClient.setQueryData(queryKey, renewedResult)
  }, [clearReason, leaseQuery.data, queryClient, queryKey, report, reportEnabled])

  const errorResult = toPerformanceErrorResult(query.error, query.isError)
  const retryAvailableAt = errorResult?.retryAfterSeconds
    ? query.errorUpdatedAt + errorResult.retryAfterSeconds * 1_000
    : 0
  const retryAfterSeconds = useRetryCountdown(retryAvailableAt)

  const authorizationLost = clearReason !== null

  return Object.freeze({
    result: authorizationLost ? null : (query.data ?? null),
    retainedReport: authorizationLost ? null : report,
    errorResult,
    isPending: !hydrated || (reportEnabled && query.isPending),
    isFetching: query.isFetching,
    hasRetainedError: report !== null && query.isError && !authorizationLost,
    authorizationLost,
    contentExpired: clearReason === 'content_expired',
    retryAfterSeconds,
    refresh: () => {
      if (clearReason !== null || !reportEnabled) {
        setClearReason(null)
        setReportEnabled(true)
        return
      }
      void query.refetch()
    },
  })
}
