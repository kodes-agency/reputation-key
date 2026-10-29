import { formatNumber } from '#/lib/format'
import {
  analysedStatement,
  windowDates,
  windowStatement,
  type ReadyInsights,
} from './property-guest-voice-window'

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

/**
 * Which window this is and what is in it, before the figures that depend on
 * both: the sentence that names the window and, when fewer reviews were read than
 * it holds, why; then the review counts, with the breakdown on request.
 */
export function PropertyGuestVoiceBasis({ result }: Readonly<{ result: ReadyInsights }>) {
  const { basis } = result
  const dates = windowDates(result)
  const analysed = analysedStatement(result)
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p className="text-foreground">{windowStatement(result)}</p>
      {analysed === null ? null : <p>{analysed}</p>}
      <p>
        Based on {pluralized(basis.reviewCount, 'review')} ·{' '}
        {formatNumber(basis.analyzedReviewCount)} analysed
      </p>
      {result.provisional ? (
        <p>
          {basis.awaitingAnalysisCount > 0
            ? `${pluralized(basis.awaitingAnalysisCount, 'review')} still being analysed.`
            : 'Analysis is still filling in.'}{' '}
          Change is hidden until analysis is complete.
        </p>
      ) : null}
      {result.range === 'all' &&
      result.windowStartBasis === 'derivative_retention_horizon' ? (
        <p>AI analysis covers the most recent 24 months.</p>
      ) : null}
      <details className="w-fit max-w-full">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground focus-ring">
          What is in this figure
        </summary>
        <dl className="grid gap-x-8 gap-y-2 pb-1 sm:grid-cols-2">
          {dates === null ? null : (
            <div className="flex justify-between gap-6 sm:col-span-2">
              <dt>Period</dt>
              <dd className="font-medium text-foreground">{dates}</dd>
            </div>
          )}
          <div className="flex justify-between gap-6">
            <dt>Reviews without text</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.starOnlyCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Awaiting analysis</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.awaitingAnalysisCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>In an unsupported language</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.notAnalyzableCount)}
            </dd>
          </div>
          <div className="flex justify-between gap-6">
            <dt>Not analysed for topics</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatNumber(basis.preAspectAnalysisCount)}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  )
}
