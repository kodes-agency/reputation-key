import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { z } from 'zod/v4'
import { getLeaderboard } from '#/contexts/leaderboard/server/leaderboards'
import { useStaffPropertyId } from '#/components/hooks/use-staff-property-id'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import type { LeaderboardEntryWithTarget } from '#/contexts/leaderboard/application/public-api'

const leaderboardSearch = z.object({
  propertyId: z.string().uuid().optional(),
  period: z
    .enum([
      'today',
      'this_week',
      'this_month',
      'this_quarter',
      'all_time',
      'last_7_days',
      'last_30_days',
      'last_90_days',
    ])
    .default('this_month'),
  scope: z.enum(['portal', 'portal_group']).default('portal'),
  metricKey: z
    .enum([
      'overall',
      'portal.rating',
      'portal.feedback',
      'portal.scan',
      'portal.review_link_click',
    ])
    .default('overall'),
})

type Period = z.infer<typeof leaderboardSearch>['period']
type Scope = z.infer<typeof leaderboardSearch>['scope']
type MetricKey = z.infer<typeof leaderboardSearch>['metricKey']

const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  this_quarter: 'This Quarter',
  all_time: 'All Time',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
}

const METRIC_LABELS: Readonly<Record<MetricKey, string>> = {
  overall: 'Overall',
  'portal.rating': 'Avg Rating',
  'portal.feedback': 'Feedback',
  'portal.scan': 'Scans',
  'portal.review_link_click': 'Link Clicks',
}

export const Route = createFileRoute('/_authenticated/leaderboard')({
  validateSearch: leaderboardSearch,
  loaderDeps: ({ search }) => ({
    propertyId: search.propertyId,
    period: search.period,
    scope: search.scope,
    metricKey: search.metricKey,
  }),
  loader: async ({ deps: { propertyId, period, scope, metricKey } }) => {
    if (!propertyId) {
      return { entries: [] as LeaderboardEntryWithTarget[] }
    }
    const entries = await getLeaderboard({
      data: { propertyId, period, scope, metricKey },
    })
    return { entries: entries as LeaderboardEntryWithTarget[] }
  },
  component: StaffLeaderboardPage,
})

function StaffLeaderboardPage() {
  const { entries } = Route.useLoaderData()
  const { propertyId: searchPropertyId, period, scope, metricKey } = Route.useSearch()
  const navigate = useNavigate()
  const localPropertyId = useStaffPropertyId()

  useEffect(() => {
    if (localPropertyId && localPropertyId !== searchPropertyId) {
      navigate({
        to: '/leaderboard',
        search: { propertyId: localPropertyId, period, scope, metricKey },
        replace: true,
      })
    }
  }, [localPropertyId, searchPropertyId, period, scope, metricKey, navigate])

  const updateSearch = (
    patch: Partial<{ period: Period; scope: Scope; metricKey: MetricKey }>,
  ) => {
    navigate({
      to: '/leaderboard',
      search: {
        propertyId: searchPropertyId ?? localPropertyId ?? undefined,
        period,
        scope,
        metricKey,
        ...patch,
      },
      replace: true,
    })
  }

  if (!localPropertyId) {
    return (
      <PageShell>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See how your portals and groups compare.
          </p>
        </div>
        <StaffEmptyState />
      </PageShell>
    )
  }

  if (localPropertyId && !searchPropertyId) {
    return null
  }

  const periods: Period[] = [
    'today',
    'this_week',
    'this_month',
    'this_quarter',
    'last_7_days',
    'last_30_days',
    'last_90_days',
    'all_time',
  ]
  const metrics: MetricKey[] = [
    'overall',
    'portal.rating',
    'portal.feedback',
    'portal.scan',
    'portal.review_link_click',
  ]

  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See how your portals and groups compare.
        </p>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => updateSearch({ period: p })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Scope toggle */}
      <div className="flex gap-2">
        {(['portal', 'portal_group'] as const).map((s) => (
          <button
            key={s}
            onClick={() => updateSearch({ scope: s })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === 'portal' ? 'Portals' : 'Portal Groups'}
          </button>
        ))}
      </div>

      {/* Metric tabs */}
      <div className="flex flex-wrap gap-2">
        {metrics.map((m) => (
          <button
            key={m}
            onClick={() => updateSearch({ metricKey: m })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              metricKey === m
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Leaderboard table */}
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No leaderboard data for this period yet. Data refreshes hourly.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Rank</th>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 text-right font-medium">
                  {metricKey === 'overall' ? 'Composite' : METRIC_LABELS[metricKey]}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr
                  key={`${entry.targetType}:${entry.targetId}`}
                  className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                >
                  <td className="px-4 py-2 font-medium">
                    {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                  </td>
                  <td className="px-4 py-2">{entry.targetName}</td>
                  <td className="px-4 py-2 text-right">
                    {(entry.score * 100).toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {entry.metricValue.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
