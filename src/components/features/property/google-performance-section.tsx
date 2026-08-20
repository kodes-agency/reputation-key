import { Link } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type { PropertyPerformancePreset } from '#/shared/google-performance-report-contract'
import {
  PROPERTY_PERFORMANCE_PRESETS,
  isPropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { cn } from '#/lib/utils'
import { GooglePerformanceReport } from './google-performance-report'
import {
  GooglePerformanceError,
  GooglePerformanceSkeleton,
  isUnavailablePerformanceResult,
} from './google-performance-states'
import {
  useGooglePerformance,
  type GooglePerformanceServerFns,
} from './use-google-performance'

const PRESET_LABELS: Readonly<Record<PropertyPerformancePreset, string>> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '180d': '180 days',
}

export function GooglePerformanceSection({
  propertyId,
  preset,
  onPresetChange,
  serverFns,
}: Readonly<{
  propertyId: string
  preset: PropertyPerformancePreset
  onPresetChange: (preset: PropertyPerformancePreset) => void
  serverFns: GooglePerformanceServerFns
}>) {
  const performance = useGooglePerformance({ propertyId, preset, serverFns })
  const report = performance.retainedReport
  const result = performance.result
  const unavailable = isUnavailablePerformanceResult(result) ? result : null
  const retryDisabled = performance.retryAfterSeconds > 0 || performance.isFetching

  return (
    <section aria-labelledby="google-performance-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id="google-performance-title"
            className="text-lg font-semibold tracking-tight"
          >
            Google Business Profile performance
          </h2>
          <p className="text-sm text-muted-foreground">
            Live discovery and customer-action signals. This range is independent from the
            Dashboard range above.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="sm:hidden">
            <Select
              value={preset}
              onValueChange={(value) => {
                if (isPropertyPerformancePreset(value)) onPresetChange(value)
              }}
            >
              <SelectTrigger aria-label="Performance range" className="min-h-11 min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_PERFORMANCE_PRESETS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PRESET_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            role="group"
            aria-label="Performance range"
            className="hidden gap-1 sm:flex"
          >
            {PROPERTY_PERFORMANCE_PRESETS.map((option) => (
              <Button
                key={option}
                type="button"
                className="h-11 min-w-16"
                variant={preset === option ? 'secondary' : 'ghost'}
                aria-pressed={preset === option}
                onClick={() => onPresetChange(option)}
              >
                {PRESET_LABELS[option]}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            className="h-11"
            variant="outline"
            disabled={retryDisabled}
            onClick={() => void performance.refresh()}
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {performance.isFetching
              ? 'Refreshing'
              : performance.retryAfterSeconds > 0
                ? `Retry in ${performance.retryAfterSeconds}s`
                : 'Refresh'}
          </Button>
        </div>
      </div>

      {performance.hasRetainedError && performance.errorResult ? (
        <GooglePerformanceError code={performance.errorResult.errorCode} retained />
      ) : null}

      {performance.authorizationLost ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle className="line-clamp-none">
            {performance.contentExpired ? 'Report expired' : 'Authorization changed'}
          </AlertTitle>
          <AlertDescription>
            This live report was cleared. Refresh to request a newly authorized report.
          </AlertDescription>
        </Alert>
      ) : performance.isPending ? (
        <GooglePerformanceSkeleton />
      ) : performance.errorResult && !report ? (
        <GooglePerformanceError code={performance.errorResult.errorCode} />
      ) : unavailable ? (
        <Alert>
          <AlertCircle aria-hidden="true" />
          <AlertTitle className="line-clamp-none">
            Performance is not available for this property
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>
              {unavailable.reason === 'timezone_required'
                ? 'Confirm the property timezone before requesting local-day performance.'
                : unavailable.reason === 'reauthentication_required'
                  ? 'Reconnect Google to restore access to this report.'
                  : unavailable.reason === 'disconnected'
                    ? 'Connect this property to Google Business Profile to view performance.'
                    : 'This report is currently disabled or unavailable.'}
            </span>
            {unavailable.action ? (
              <Button variant="outline" asChild>
                <Link
                  to={
                    unavailable.action === 'set_timezone'
                      ? '/properties/import-google'
                      : '/settings/integrations'
                  }
                >
                  {unavailable.action === 'set_timezone'
                    ? 'Review property import'
                    : 'Open integrations'}
                </Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : report ? (
        <div
          className={cn('flex flex-col gap-4', performance.isFetching && 'opacity-80')}
        >
          <GooglePerformanceReport report={report} />
        </div>
      ) : null}
    </section>
  )
}
