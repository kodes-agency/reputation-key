import { Link } from '@tanstack/react-router'
import { ArrowRight, BrainCircuit } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { StatusBadge } from '#/components/ui/status-badge'
import type { MerchantAiOverview } from '#/contexts/identity/application/public-api'
import type {
  AiOrganizationMonthSpend,
  ReviewAnalysisProgress,
} from '#/contexts/ai/application/public-api'
import { cn } from '#/lib/utils'
import { Metric, MetricStrip, MetricValue } from '#/components/ui/metric-strip'
import { ROW_LINK_SURFACE } from '#/components/ui/row-link'
import {
  AI_OVERVIEW_STATUS,
  aiCapabilityLabel,
  aiOverviewStatus,
  analysisSummary,
  formatMicros,
  spendShare,
  summarizeAiOverview,
} from './organization-ai-overview-model'

type Props = Readonly<{
  overview: MerchantAiOverview
  spend: AiOrganizationMonthSpend | undefined
  progressByProperty: ReadonlyMap<string, ReviewAnalysisProgress | undefined>
}>

/**
 * The organization's AI at a glance. Nothing here changes anything: each
 * property row opens that property's own AI settings, where consent is given
 * and features are chosen.
 */
export function OrganizationAiOverviewPage({
  overview,
  spend,
  progressByProperty,
}: Props) {
  if (overview.properties.length === 0) {
    return (
      <EmptyState
        icon={BrainCircuit}
        title="No properties to manage AI for"
        description="Import a property from Google, then turn on AI in its settings."
      />
    )
  }
  const summary = summarizeAiOverview(overview.properties)

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <section aria-label="AI summary" className="flex flex-col gap-4">
        <MetricStrip aria-label="AI at a glance" variant="tiles">
          <Metric label="AI on">
            <MetricValue
              value={`${summary.on} of ${summary.total}`}
              detail="properties"
            />
          </Metric>
          <Metric label="Re-consent needed">
            <MetricValue value={String(summary.reconsent)} />
          </Metric>
          <Metric label="Not decided">
            <MetricValue value={String(summary.undecided)} />
          </Metric>
          <Metric label="Spend this month">
            <MetricValue
              value={spend ? formatMicros(spend.settledMicros) : '…'}
              detail={spend ? `of ${formatMicros(spend.capMicros)} limit` : undefined}
            />
          </Metric>
        </MetricStrip>
        {spend ? (
          <div
            role="meter"
            aria-label="Monthly AI spend against the limit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spendShare(spend) * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                'h-full w-full origin-left rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none',
                spendShare(spend) >= 0.9 ? 'bg-destructive' : 'bg-primary',
              )}
              style={{ transform: `scaleX(${spendShare(spend)})` }}
            />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="ai-overview-properties">
        <h2 id="ai-overview-properties" className="sr-only">
          Properties
        </h2>
        <ul className="divide-y rounded-lg border">
          {overview.properties.map((entry) => {
            const status = aiOverviewStatus(entry)
            return (
              <li key={entry.propertyId}>
                <Link
                  to="/properties/$propertyId/settings/ai"
                  params={{ propertyId: entry.propertyId }}
                  className={cn(
                    'group grid gap-2 p-4 md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1.6fr)_minmax(0,1fr)_1rem] md:items-center md:gap-4',
                    ROW_LINK_SURFACE,
                  )}
                >
                  <span className="min-w-0 truncate font-medium">
                    {entry.propertyName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={status} map={AI_OVERVIEW_STATUS} />
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5 text-xs">
                    {entry.reconsentRequired ? (
                      <StatusBadge tone="warn" label="Re-consent needed" />
                    ) : null}
                    {!entry.googleBindingActive ? (
                      <StatusBadge tone="warn" label="Google not linked" />
                    ) : null}
                    {entry.state === 'enabled'
                      ? entry.capabilities.map((capability) => (
                          <Badge
                            key={capability}
                            variant="secondary"
                            className="font-normal"
                          >
                            {aiCapabilityLabel(capability)}
                          </Badge>
                        ))
                      : null}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {entry.state === 'enabled' &&
                    entry.capabilities.includes('review_analysis')
                      ? analysisSummary(progressByProperty.get(entry.propertyId))
                      : null}
                  </span>
                  <ArrowRight
                    className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
