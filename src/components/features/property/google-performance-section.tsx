import { Link } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type {
  PropertyGooglePerformanceReportV1,
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
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

/**
 * Refresh only. The range used to live here as a second picker on the same page
 * as the overview's own, with prose conceding that the two were unrelated:
 * "This range is independent from the Dashboard range above." The Google page
 * now owns one shared range in its header (redesign rows 6, 7b), so this
 * section keeps the one control that is genuinely its own — the lease refresh,
 * with its cooldown.
 */
function GooglePerformanceRefresh({
  isFetching,
  retryAfterSeconds,
  onRefresh,
}: Readonly<{
  isFetching: boolean
  retryAfterSeconds: number
  onRefresh: () => void
}>) {
  const retryDisabled = retryAfterSeconds > 0 || isFetching

  return (
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

/**
 * The Google report, and the refresh that owns its lease. The page supplies the
 * range and the heading; this section contributes no header of its own, only
 * the one control that is genuinely its own.
 */
export function GooglePerformanceSection({
  propertyId,
  preset,
  serverFns,
}: Readonly<{
  propertyId: string
  preset: PropertyPerformancePreset
  serverFns: GooglePerformanceServerFns
}>) {
  const performance = useGooglePerformance({ propertyId, preset, serverFns })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <GooglePerformanceRefresh
          isFetching={performance.isFetching}
          retryAfterSeconds={performance.retryAfterSeconds}
          onRefresh={() => void performance.refresh()}
        />
      </div>

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
    </div>
  )
}
