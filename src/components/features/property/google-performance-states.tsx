import { AlertCircle } from 'lucide-react'
import type { PropertyGooglePerformanceResultV1 } from '#/shared/google-performance-report-contract'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'

export type UnavailablePerformanceResult = Extract<
  PropertyGooglePerformanceResultV1,
  { status: 'unavailable' }
>

export function isUnavailablePerformanceResult(
  value: PropertyGooglePerformanceResultV1 | null,
): value is UnavailablePerformanceResult {
  return value?.status === 'unavailable'
}

export function GooglePerformanceSkeleton() {
  return (
    <div
      aria-label="Loading Google Business Profile performance"
      role="status"
      className="flex flex-col gap-4"
    >
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

function errorMessage(code: string): string {
  switch (code) {
    case 'rate_limited':
      return 'Google is limiting requests. Keep the current report or retry after the wait period.'
    case 'provider_timeout':
      return 'Google took too long to respond. The rest of your Dashboard is still current.'
    case 'provider_rejected':
      return 'Google could not authorize this report. Check the property connection.'
    case 'malformed_provider_response':
      return 'Google returned data that could not be safely displayed.'
    case 'stale_source':
      return 'The property connection changed while this report was loading.'
    default:
      return 'Google Business Profile performance is temporarily unavailable.'
  }
}

export function GooglePerformanceError({
  code,
  retained,
}: Readonly<{ code: string; retained?: boolean }>) {
  return (
    <Alert variant={retained ? 'default' : 'destructive'}>
      <AlertCircle aria-hidden="true" />
      <AlertTitle className="line-clamp-none">
        {retained
          ? 'Showing the last successful report'
          : 'Performance report unavailable'}
      </AlertTitle>
      <AlertDescription>{errorMessage(code)}</AlertDescription>
    </Alert>
  )
}
