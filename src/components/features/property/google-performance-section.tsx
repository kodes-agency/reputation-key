import { Link } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type {
  PropertyGooglePerformanceReportV1,
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
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
import { usePermissions } from '#/shared/hooks/usePermissions'
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

type UnavailablePerformanceResult = Extract<
  PropertyGooglePerformanceResultV1,
  { status: 'unavailable' }
>

type ErrorPerformanceResult = Extract<
  PropertyGooglePerformanceResultV1,
  { status: 'error' }
>

type GooglePerformanceContentProps = Readonly<{
  report: PropertyGooglePerformanceReportV1 | null
  result: PropertyGooglePerformanceResultV1 | null
  errorResult: ErrorPerformanceResult | null
  isPending: boolean
  isFetching: boolean
  authorizationLost: boolean
  contentExpired: boolean
}>

const UNAVAILABLE_DESCRIPTIONS: Readonly<
  Record<UnavailablePerformanceResult['reason'], string>
> = {
  timezone_required:
    'Confirm the property timezone before requesting local-day performance.',
  reauthentication_required: 'Reconnect Google to restore access to this report.',
  disconnected: 'Connect this property to Google Business Profile to view performance.',
  policy_disabled: 'This report is currently disabled or unavailable.',
  integration_unavailable: 'This report is currently disabled or unavailable.',
}

function GooglePerformanceUnavailable({
  unavailable,
}: Readonly<{ unavailable: UnavailablePerformanceResult }>) {
  const { can } = usePermissions()
  const requiresPropertyImport = unavailable.action === 'set_timezone'
  const canOpenAction =
    unavailable.action !== null &&
    can(requiresPropertyImport ? 'property.import_gbp_v2' : 'integration.manage')

  return (
    <Alert>
      <AlertCircle aria-hidden="true" />
      <AlertTitle className="line-clamp-none">
        Performance is not available for this property
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{UNAVAILABLE_DESCRIPTIONS[unavailable.reason]}</span>
        {canOpenAction ? (
          <Button asChild size="xs" variant="link">
            <Link
              to={
                requiresPropertyImport
                  ? '/properties/import-google'
                  : '/settings/integrations'
              }
            >
              {requiresPropertyImport ? 'Review property import' : 'Open integrations'}
            </Link>
          </Button>
        ) : (
          <span>Ask an account admin to review this property&apos;s Google setup.</span>
        )}
      </AlertDescription>
    </Alert>
  )
}

function GooglePerformanceHeader({
  preset,
  onPresetChange,
  isFetching,
  retryAfterSeconds,
  onRefresh,
}: Readonly<{
  preset: PropertyPerformancePreset
  onPresetChange: (preset: PropertyPerformancePreset) => void
  isFetching: boolean
  retryAfterSeconds: number
  onRefresh: () => void
}>) {
  const retryDisabled = retryAfterSeconds > 0 || isFetching

  return (
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
        <div role="group" aria-label="Performance range" className="hidden gap-1 sm:flex">
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
          onClick={onRefresh}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {isFetching
            ? 'Refreshing'
            : retryAfterSeconds > 0
              ? `Retry in ${retryAfterSeconds}s`
              : 'Refresh'}
        </Button>
      </div>
    </div>
  )
}

function GooglePerformanceContent({
  report,
  result,
  errorResult,
  isPending,
  isFetching,
  authorizationLost,
  contentExpired,
}: GooglePerformanceContentProps) {
  const unavailable = isUnavailablePerformanceResult(result) ? result : null

  if (authorizationLost) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle className="line-clamp-none">
          {contentExpired ? 'Report expired' : 'Authorization changed'}
        </AlertTitle>
        <AlertDescription>
          This live report was cleared. Refresh to request a newly authorized report.
        </AlertDescription>
      </Alert>
    )
  }
  if (isPending) return <GooglePerformanceSkeleton />
  if (errorResult && !report) {
    return <GooglePerformanceError code={errorResult.errorCode} />
  }
  if (unavailable) return <GooglePerformanceUnavailable unavailable={unavailable} />
  if (!report) return null

  return (
    <div className={cn('flex flex-col gap-4', isFetching && 'opacity-80')}>
      <GooglePerformanceReport report={report} />
    </div>
  )
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

  return (
    <section aria-labelledby="google-performance-title" className="flex flex-col gap-4">
      <GooglePerformanceHeader
        preset={preset}
        onPresetChange={onPresetChange}
        isFetching={performance.isFetching}
        retryAfterSeconds={performance.retryAfterSeconds}
        onRefresh={() => void performance.refresh()}
      />

      {performance.hasRetainedError && performance.errorResult ? (
        <GooglePerformanceError code={performance.errorResult.errorCode} retained />
      ) : null}

      <GooglePerformanceContent
        report={performance.retainedReport}
        result={performance.result}
        errorResult={performance.errorResult}
        isPending={performance.isPending}
        isFetching={performance.isFetching}
        authorizationLost={performance.authorizationLost}
        contentExpired={performance.contentExpired}
      />
    </section>
  )
}
