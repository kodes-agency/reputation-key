import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, BrainCircuit } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import type { MerchantAiOverview } from '#/contexts/identity/application/public-api'
import type {
  AiOrganizationMonthSpend,
  ReviewAnalysisProgress,
} from '#/contexts/ai/application/public-api'
import { cn } from '#/lib/utils'
import {
  AI_OVERVIEW_STATUS_LABEL,
  aiCapabilityLabel,
  aiOverviewStatus,
  analysisSummary,
  formatMicros,
  spendShare,
  summarizeAiOverview,
  type AiOverviewStatus,
} from './organization-ai-overview-model'

type Props = Readonly<{
  overview: MerchantAiOverview
  spend: AiOrganizationMonthSpend | undefined
  progressByProperty: ReadonlyMap<string, ReviewAnalysisProgress | undefined>
}>

const STATUS_TONE: Readonly<Record<AiOverviewStatus, string>> = {
  on: 'border-positive/30 bg-positive-muted text-positive',
  not_now: 'text-muted-foreground',
  turned_off: 'text-muted-foreground',
  off: 'border-dashed text-muted-foreground',
}

function Fact({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  )
}

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
      <EmptyState icon={BrainCircuit} title="No properties to manage AI for">
        <p className="max-w-md text-sm text-muted-foreground">
          Import a property from Google, then turn on AI in its settings.
        </p>
      </EmptyState>
    )
  }
  const summary = summarizeAiOverview(overview.properties)

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <section aria-label="AI summary" className="rounded-lg border p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact
            label="AI on"
            value={`${summary.on} of ${summary.total}`}
            hint="properties"
          />
          <Fact label="Re-consent needed" value={String(summary.reconsent)} />
          <Fact label="Not decided" value={String(summary.undecided)} />
          <Fact
            label="Spend this month"
            value={spend ? formatMicros(spend.settledMicros) : '…'}
            hint={spend ? `of ${formatMicros(spend.capMicros)} limit` : undefined}
          />
        </dl>
        {spend ? (
          <div
            role="meter"
            aria-label="Monthly AI spend against the limit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spendShare(spend) * 100)}
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
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
                  className="group grid gap-2 p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1.6fr)_minmax(0,1fr)_1rem] md:items-center md:gap-4"
                >
                  <span className="min-w-0 truncate font-medium">
                    {entry.propertyName}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={STATUS_TONE[status]}>
                      {AI_OVERVIEW_STATUS_LABEL[status]}
                    </Badge>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5 text-xs">
                    {entry.reconsentRequired ? (
                      <Badge
                        variant="outline"
                        className="border-warn-line bg-warn-muted text-warn"
                      >
                        Re-consent needed
                      </Badge>
                    ) : null}
                    {!entry.googleBindingActive ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <AlertTriangle className="size-3.5" aria-hidden="true" />
                        Google not linked
                      </span>
                    ) : null}
                    {entry.state === 'enabled'
                      ? entry.capabilities.map((capability) => (
                          <span
                            key={capability}
                            className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                          >
                            {aiCapabilityLabel(capability)}
                          </span>
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
